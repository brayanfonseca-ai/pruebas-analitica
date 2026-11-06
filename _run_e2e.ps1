$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$out = "c:\Users\brayan.fonseca\OneDrive - PHARI TECH SERVICES SAS\Escritorio\Preuba\_e2e_dom.html"
$url = "http://localhost:8080/_e2e_feat002.html"
$profile = "c:\Users\brayan.fonseca\OneDrive - PHARI TECH SERVICES SAS\Escritorio\Preuba\_chrome_prof"
& $chrome --headless=new --disable-gpu --no-sandbox --user-data-dir="$profile" --virtual-time-budget=45000 --run-all-compositor-stages-before-draw --dump-dom $url 2>$null | Out-File -FilePath $out -Encoding utf8
"EXIT " + $LASTEXITCODE | Out-File -FilePath "c:\Users\brayan.fonseca\OneDrive - PHARI TECH SERVICES SAS\Escritorio\Preuba\_e2e_exit.txt"
