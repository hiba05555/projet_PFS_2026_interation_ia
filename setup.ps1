# =============================================================================
# ERP DataProtect — Setup IA Stack (Windows PowerShell)
# =============================================================================
# A executer UNE FOIS apres le premier "docker-compose up -d".
# Prerequis : docker-compose up -d deja lance, tous les services UP.
#
# Ce script :
#   1. Copie le modele Mistral (.gguf 4.3 Go) dans le conteneur Ollama
#   2. Cree le modele "erp-dataprotect" dans Ollama via le Modelfile
#   3. Vectorise erp_documentation.json dans ChromaDB via un conteneur Python
#   4. Verifie le resultat final
#
# Duree estimee : 15-30 min (copie .gguf + import ollama + telechargement
#                             sentence-transformers + vectorisation)
# =============================================================================

$ErrorActionPreference = "Stop"

$RepoRoot  = $PSScriptRoot
$GgufFile  = Join-Path $RepoRoot "chatbot-finetuning\mistral-7b-instruct-v0.3.Q4_K_M.gguf"
$Modelfile = Join-Path $RepoRoot "chatbot-finetuning\Modelfile"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  ERP DataProtect - Initialisation de la Stack IA"           -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ------ Verification des prerequis ----------------------------------------
Write-Host "[0/3] Verification des prerequis..." -ForegroundColor Yellow

$runningContainers = docker ps --format "{{.Names}}"

if ($runningContainers -notcontains "erp-ollama") {
    Write-Host "ERREUR : Le conteneur erp-ollama n'est pas demarre." -ForegroundColor Red
    Write-Host "Lancez d'abord : docker-compose up -d"
    exit 1
}

if ($runningContainers -notcontains "erp-chromadb") {
    Write-Host "ERREUR : Le conteneur erp-chromadb n'est pas demarre." -ForegroundColor Red
    Write-Host "Lancez d'abord : docker-compose up -d"
    exit 1
}

if (-not (Test-Path $GgufFile)) {
    Write-Host "ERREUR : Fichier introuvable : $GgufFile" -ForegroundColor Red
    Write-Host "Verifiez que le fichier .gguf est present (git lfs pull si besoin)."
    exit 1
}

$GgufSize = [math]::Round((Get-Item $GgufFile).Length / 1GB, 1)
Write-Host "  OK - erp-ollama  : demarre"
Write-Host "  OK - erp-chromadb : demarre"
Write-Host "  OK - $GgufFile ($GgufSize Go)"
Write-Host ""

# ------ Etape 1 : Import modele dans Ollama --------------------------------
Write-Host "[1/3] Verification du modele Ollama..." -ForegroundColor Yellow

$ollamaModels = docker exec erp-ollama ollama list 2>&1
$modelExists = $ollamaModels | Select-String "erp-dataprotect"

if ($modelExists) {
    Write-Host "  OK - Modele erp-dataprotect deja present, etape ignoree." -ForegroundColor Green
} else {
    Write-Host "      Modele absent - import en cours..."
    Write-Host "      Copie du .gguf ($GgufSize Go) dans le conteneur (2-5 min)..."

    docker cp $GgufFile erp-ollama:/tmp/mistral-7b-instruct-v0.3.Q4_K_M.gguf
    docker cp $Modelfile erp-ollama:/tmp/Modelfile

    Write-Host "      Creation du modele erp-dataprotect (5-15 min)..."
    docker exec erp-ollama ollama create erp-dataprotect -f /tmp/Modelfile

    Write-Host "      Modeles disponibles dans Ollama :"
    docker exec erp-ollama ollama list
}
Write-Host ""

# ------ Etape 2 : Vectorisation ChromaDB -----------------------------------
Write-Host "[2/3] Verification de la collection ChromaDB..." -ForegroundColor Yellow

$chromaAlreadyDone = $false
try {
    $cols = Invoke-RestMethod "http://localhost:8000/api/v2/tenants/default_tenant/databases/default_database/collections" -ErrorAction Stop
    $erpCol = $cols | Where-Object { $_.name -eq "erp_dataprotect_docs" }
    if ($erpCol) {
        Write-Host "  OK - Collection erp_dataprotect_docs deja presente, etape ignoree." -ForegroundColor Green
        $chromaAlreadyDone = $true
    }
} catch {
    # ChromaDB inaccessible ou collection absente — on vectorise
}

if (-not $chromaAlreadyDone) {
    Write-Host "      Collection absente - vectorisation en cours..."
    Write-Host "      Telechargement de sentence-transformers (~100 Mo la premiere fois)"
    Write-Host "      puis indexation des 35 documents..."
    Write-Host ""

    # Sur Windows Docker Desktop, host.docker.internal pointe vers l'hote.
    # ChromaDB est expose sur localhost:8000 -> accessible via host.docker.internal:8000.
    # Le conteneur reste sur le bridge par defaut (acces internet pour pip install).
    $RagPath = Join-Path $RepoRoot "chatbot-rag"

    docker run --rm `
        -v "${RagPath}:/app" `
        -w /app `
        -e CHROMADB_HOST=host.docker.internal `
        python:3.11-slim `
        sh -c "pip install 'chromadb>=1.0.0' --no-cache-dir -q && python vectorize_docs.py"
}

Write-Host ""

# ------ Etape 3 : Verification --------------------------------------------
Write-Host "[3/3] Verification finale..." -ForegroundColor Yellow
Write-Host ""

Write-Host "  Collections ChromaDB :"
try {
    $cols = Invoke-RestMethod "http://localhost:8000/api/v2/tenants/default_tenant/databases/default_database/collections"
    Write-Host "  $($cols.Count) collection(s) : $($cols.name -join ', ')"
} catch {
    Write-Host "  (impossible d'interroger ChromaDB : $($_.Exception.Message))"
}
Write-Host ""

Write-Host "  Modeles Ollama :"
docker exec erp-ollama ollama list
Write-Host ""

Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Setup termine !" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Redemarrez le conteneur chatbot :"
Write-Host "    docker restart erp-chatbot" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Test rapide :"
Write-Host "    Invoke-RestMethod http://localhost:3500/health" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Pour obtenir un JWT de test :"
Write-Host "    `$r = Invoke-RestMethod http://localhost:3000/api/auth/login -Method Post\" -ForegroundColor Cyan
Write-Host "          -ContentType application/json" -ForegroundColor Cyan
Write-Host "          -Body '{""email"":""admin@erp.com"",""password"":""admin123""}'" -ForegroundColor Cyan
Write-Host "    `$jwt = `$r.token" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Test du chatbot :"
Write-Host "    Invoke-RestMethod http://localhost:3500/chat -Method Post\" -ForegroundColor Cyan
Write-Host "          -Headers @{Authorization=""Bearer `$jwt""} -ContentType application/json\" -ForegroundColor Cyan
Write-Host "          -Body '{""message"":""Comment creer un ticket helpdesk ?"",""conversationId"":""test""}'" -ForegroundColor Cyan
Write-Host ""
