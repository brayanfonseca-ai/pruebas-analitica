$out = "c:\Users\brayan.fonseca\OneDrive - PHARI TECH SERVICES SAS\Escritorio\Preuba\_ds_probe.txt"
try {
  $r = Invoke-WebRequest -Uri "http://localhost:8080/index.html" -UseBasicParsing -TimeoutSec 10
  Set-Content -Path $out -Value ("HTTP " + $r.StatusCode)
} catch {
  Set-Content -Path $out -Value ("ERR " + $_.Exception.Message)
}
