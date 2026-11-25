package io.datasense.ask;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.datasense.ai.BedrockService;
import io.datasense.engine.DataFrame;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;
import java.util.function.BiFunction;

/**
 * Ayuda de IA al escribir una medida o una dimensión: «dame la suma de ventas de Cali» → {@code SUM(ventas) FILTER (WHERE ciudad = 'CALI')}.
 * La IA solo ve el catálogo de campos (nombre, tabla, tipo y algunos valores de los campos de texto), nunca filas completas.
 * La respuesta se valida en el motor; si no compila se le devuelve el error una vez para que la corrija.
 */
@Service
public class ExpressionAssist {

    private final AskService ask;
    private final BedrockService bedrock;
    private final ObjectMapper json = new ObjectMapper();

    public ExpressionAssist(AskService ask, BedrockService bedrock) {
        this.ask = ask;
        this.bedrock = bedrock;
    }

    /** {@code validate(kind, expression)} compila (y en medidas calcula el valor); lanza si no es válida. */
    public Map<String, Object> suggest(String appId, String kind, String prompt, String current,
                                       BiFunction<String, String, Map<String, Object>> validate) {
        AskService.Model m = ask.model(appId);
        if (m.frames.isEmpty()) return fail("La aplicación no tiene datos cargados todavía.");
        boolean measure = !"dimension".equals(kind);
        String system = system(measure) + "\n\nCAMPOS DISPONIBLES:\n" + catalog(m);
        String user = "Petición: " + prompt + (current == null || current.isBlank() ? "" : "\nExpresión actual (puedes partir de ella): " + current);
        String lastErr = null, lastExpr = null;
        for (int attempt = 1; attempt <= 2; attempt++) {
            String u = lastErr == null ? user : user + "\n\nTu respuesta anterior «" + lastExpr + "» no es válida: " + lastErr + "\nCorrígela.";
            BedrockService.AiResult r = bedrock.converse(system, u);
            if (!r.ok()) return fail(r.message() == null ? "La IA no está disponible en este momento." : r.message());
            String expr, why;
            try {
                JsonNode j = json.readTree(extractJson(r.text()));
                expr = j.path("expression").asText("").strip();
                why = j.path("explanation").asText("").strip();
            } catch (Exception e) {
                lastErr = "responde solo con JSON {\"expression\": …, \"explanation\": …}"; lastExpr = r.text(); continue;
            }
            if (expr.isEmpty()) {
                if (!why.isEmpty()) return fail(why);
                lastErr = "la expresión está vacía"; lastExpr = expr; continue;
            }
            // la IA a veces olvida las comillas de los nombres con espacios: se ponen antes de validar y mostrar
            expr = io.datasense.engine.ExprLang.autoQuote(expr, m.fieldIndex.keySet());
            try {
                Map<String, Object> res = validate.apply(measure ? "measure" : "dimension", expr);
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("ok", true);
                out.put("expression", expr);
                out.put("explanation", why);
                out.put("table", res.get("table"));
                if (res.get("value") != null) out.put("value", res.get("value"));
                if (res.get("sample") != null) out.put("sample", res.get("sample"));
                out.put("attempts", attempt);
                return out;
            } catch (ResponseStatusException e) {
                lastErr = e.getReason(); lastExpr = expr;
            } catch (RuntimeException e) {
                lastErr = e.getMessage(); lastExpr = expr;
            }
        }
        Map<String, Object> out = fail("No logré una expresión válida: " + lastErr);
        out.put("expression", lastExpr);
        return out;
    }

    private static Map<String, Object> fail(String msg) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("ok", false);
        o.put("message", msg);
        return o;
    }

    private static String extractJson(String t) {
        String s = t == null ? "" : t.strip();
        int a = s.indexOf('{'), b = s.lastIndexOf('}');
        return a >= 0 && b > a ? s.substring(a, b + 1) : s;
    }

    private static String system(boolean measure) {
        String common = """
                Eres el asistente de expresiones de PROTHEO. Escribes expresiones en SQL estándar para el motor analítico.
                Responde SOLO con JSON, sin texto alrededor: {"expression": "...", "explanation": "una o dos frases en español"}.
                Reglas:
                - Usa EXACTAMENTE los nombres de campo del catálogo. Si un nombre tiene espacios, tildes o símbolos va entre comillas dobles: "ESTADO CONTRATO". Si es simple puede ir sin comillas.
                - Textos entre comillas simples: 'Inactivo'. Usa los valores tal como aparecen en el catálogo (respeta mayúsculas).
                - Todos los campos de la expresión deben estar en UNA misma tabla. Escribe solo el nombre del campo, sin el nombre de la tabla delante.
                - No agregues condiciones que el usuario no pidió.
                - Funciones permitidas: SUM, COUNT, AVG, MIN, MAX, COUNT(DISTINCT x), FILTER (WHERE …), CASE WHEN … THEN … ELSE … END, COALESCE, ROUND, ABS, FLOOR, CEIL,
                  UPPER, LOWER, TRIM, LENGTH, SUBSTRING, LEFT, RIGHT, REPLACE, YEAR, MONTH, DAY, CAST(x AS VARCHAR|INTEGER|DOUBLE|DATE), x IN (…), BETWEEN, LIKE 'abc%', IS NULL, ||.
                - No inventes campos. Si la petición no se puede hacer con estos campos, deja "expression" vacío y explica por qué en "explanation".
                """;
        return common + (measure ? """
                Estás escribiendo una MEDIDA: debe agregar (SUM, COUNT, AVG, MIN, MAX o COUNT(DISTINCT …)).
                - Condiciones: COUNT(*) FILTER (WHERE estado = 'Inactivo') o SUM(valor) FILTER (WHERE ciudad = 'CALI').
                - Porcentajes: ROUND(100.0 * COUNT(*) FILTER (WHERE …) / COUNT(campo), 2).
                - Personas o registros únicos: COUNT(DISTINCT cedula).
                - No agregues GROUP BY, SELECT ni FROM: solo la expresión.
                """ : """
                Estás escribiendo una DIMENSIÓN: una expresión por fila SIN agregaciones (no uses SUM/COUNT/AVG/MIN/MAX).
                - Grupos: CASE WHEN edad >= 40 THEN 'Mayor de 40' ELSE 'Menor de 40' END.
                - Unir textos: ciudad || ' - ' || sucursal. Año de una fecha: YEAR(fecha).
                - No agregues SELECT ni FROM: solo la expresión.
                """);
    }

    /** Catálogo compacto: por tabla, cada campo con su tipo y, en los de texto con pocos valores, ejemplos. */
    private static String catalog(AskService.Model m) {
        StringBuilder sb = new StringBuilder();
        Map<String, List<AskService.Field>> byTable = new LinkedHashMap<>();
        for (AskService.Field f : m.fields) byTable.computeIfAbsent(f.table, k -> new ArrayList<>()).add(f);
        int budget = 9000;
        for (var e : byTable.entrySet()) {
            DataFrame df = m.frames.get(e.getKey());
            sb.append("Tabla ").append(e.getKey()).append(df == null ? "" : " (" + df.rowCount() + " filas)").append(":\n");
            for (AskService.Field f : e.getValue()) {
                StringBuilder line = new StringBuilder("  - \"").append(f.name).append("\" (").append(f.type == null ? "texto" : f.type).append(')');
                if (f.display != null && !f.display.equals(f.name)) line.append(" alias «").append(f.display).append('»');
                List<String> vals = f.values == null ? List.of() : f.values;
                if ("text".equals(f.type) && !vals.isEmpty() && vals.size() <= 40)
                    line.append(" valores: ").append(String.join(", ", vals.stream().limit(10).map(v -> "'" + v + "'").toList())).append(vals.size() > 10 ? ", …" : "");
                line.append('\n');
                if (sb.length() + line.length() > budget) { sb.append("  …\n"); return sb.toString(); }
                sb.append(line);
            }
        }
        return sb.toString();
    }
}
