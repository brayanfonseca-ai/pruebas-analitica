package io.datasense.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Redirige la raíz "/" al login (index.html), igual que el StaticFiles mount
 * del backend Python servía index.html en "/". Sin esto, "/" devolvía la
 * Whitelabel Error Page 404.
 */
@Controller
public class RootController {

    @GetMapping("/")
    public String root() {
        return "redirect:/index.html";
    }
}
