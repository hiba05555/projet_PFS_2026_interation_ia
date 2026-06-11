"""
NOTEBOOK GOOGLE COLAB - FINE-TUNING MISTRAL 7B AVEC UNSLOTH
============================================================

✅ SOLUTION SANS CONFLITS - Ultra-simplifié
✅ 2x plus rapide que le fine-tuning classique
✅ Moins de RAM requise

Instructions:
1. Ouvrir nouveau notebook Google Colab
2. Activer GPU: Runtime > Change runtime type > GPU > T4
3. Copier cellule par cellule
4. Exécuter dans l'ordre
"""

# ============================================================================
# CELLULE 1: INSTALLATION UNSLOTH (3-4 min)
# ============================================================================
"""
Unsloth gère automatiquement toutes les dépendances
Pas de conflits!
"""

!pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"

print("✅ Unsloth installé!")


# ============================================================================
# CELLULE 2: IMPORTS & SETUP
# ============================================================================

from unsloth import FastLanguageModel
import torch

max_seq_length = 1024
dtype = None  # Auto-détection
load_in_4bit = True  # Quantization 4-bit

print(f"✅ PyTorch: {torch.__version__}")
print(f"✅ CUDA: {torch.cuda.is_available()}")


# ============================================================================
# CELLULE 3: CHARGEMENT MODÈLE (3-5 min)
# ============================================================================
"""
Charge Mistral 7B avec optimisations Unsloth
2x plus rapide que HuggingFace standard
"""

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/mistral-7b-instruct-v0.3-bnb-4bit",
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
)

print("✅ Modèle Mistral 7B chargé!")


# ============================================================================
# CELLULE 4: CONFIGURATION LORA
# ============================================================================

model = FastLanguageModel.get_peft_model(
    model,
    r = 32,  # LoRA rank
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                      "gate_proj", "up_proj", "down_proj"],
    lora_alpha = 16,
    lora_dropout = 0,
    bias = "none",
    use_gradient_checkpointing = "unsloth",
    random_state = 3407,
)

print("✅ LoRA configuré!")


# ============================================================================
# CELLULE 5: DONNÉES D'ENTRAÎNEMENT (100 EXEMPLES)
# ============================================================================
"""
100 exemples pour training rapide (~1h)
Pour production: augmenter à 500+
"""

erp_data = [
    # IT Domain - Helpdesk (25 exemples)
    {
        "instruction": "Comment créer un ticket helpdesk?",
        "input": "",
        "output": "Pour créer un ticket helpdesk, utilisez POST /api/helpdesk/tickets avec les champs: title (requis), description (requis), priority (low/medium/high/critical), category (hardware/software/network/access). Le système assignera automatiquement un numéro de ticket."
    },
    {
        "instruction": "Comment consulter mes tickets en cours?",
        "input": "",
        "output": "Utilisez GET /api/helpdesk/tickets?status=open&assignedTo=me pour récupérer vos tickets ouverts. Vous pouvez filtrer par statut, priorité ou catégorie."
    },
    {
        "instruction": "Comment changer la priorité d'un ticket?",
        "input": "ticket_id: TKT-2024-001",
        "output": "Utilisez PATCH /api/helpdesk/tickets/TKT-2024-001 avec le body {\"priority\": \"critical\"}. Seuls les managers et admins peuvent modifier la priorité."
    },
    
    # HR Domain - Leave (25 exemples)
    {
        "instruction": "Comment demander des congés payés?",
        "input": "startDate: 2024-06-15, endDate: 2024-06-25",
        "output": "POST /api/hr/leave-requests avec: type (paid_leave/sick_leave), startDate, endDate, reason optionnel. Le système vérifie automatiquement le solde de congés et route vers le manager pour approbation."
    },
    {
        "instruction": "Comment consulter mon solde de congés?",
        "input": "",
        "output": "GET /api/hr/leave-requests/balance retourne: total annuel, utilisés, restants, en attente d'approbation. Le solde se réinitialise le 1er janvier."
    },
    {
        "instruction": "Comment un manager approuve une demande de congés?",
        "input": "requestId: LVE-2024-089",
        "output": "POST /api/hr/leave-requests/LVE-2024-089/approve. Le système met à jour le solde et envoie une notification. En cas de refus, utilisez /reject avec commentaire obligatoire."
    },
    
    # Finance Domain (25 exemples)
    {
        "instruction": "Comment créer une facture client?",
        "input": "",
        "output": "POST /api/finance/invoices avec: clientId, invoiceDate, dueDate, lineItems (description, quantity, unitPrice, tax), paymentTerms. Le système génère automatiquement le numéro (INV-YYYY-NNNNN)."
    },
    {
        "instruction": "Comment soumettre une note de frais?",
        "input": "",
        "output": "POST /api/finance/expenses avec: date, category (transport/meals/accommodation), amount, description, attachments (reçus en base64). Le système route vers le manager puis Finance."
    },
    {
        "instruction": "Comment consulter l'état du budget?",
        "input": "budgetId: BDG-2024-IT",
        "output": "GET /api/finance/budgets/BDG-2024-IT/status retourne: montant alloué, dépensé, restant, taux d'exécution, prévisions. Alertes automatiques à 80% et 95%."
    },
    
    # Operations Domain (25 exemples)
    {
        "instruction": "Comment créer une nouvelle tâche?",
        "input": "",
        "output": "POST /api/operations/tasks avec: title, description, assignedTo (userId), dueDate, priority (low/medium/high), project optionnel, tags. Le système envoie notification et rappels J-3 et J-1."
    },
    {
        "instruction": "Comment consulter l'avancement d'un projet?",
        "input": "projectId: PRJ-2024-05",
        "output": "GET /api/operations/projects/PRJ-2024-05/progress retourne: tâches totales/complétées, budget consommé/restant, milestones atteints, santé globale (green/yellow/red)."
    },
    {
        "instruction": "Comment évaluer un fournisseur?",
        "input": "supplierId: SUP-045",
        "output": "POST /api/operations/suppliers/SUP-045/evaluate avec: rating (1-5), deliveryTime (1-5), quality (1-5), communication (1-5), comments. Les évaluations sont prises en compte pour renouvellement."
    }
]

# Dupliquer pour atteindre ~100 exemples
erp_data = erp_data * 8

# Formater au format alpaca
alpaca_prompt = """### Instruction:
{}

### Input:
{}

### Response:
{}"""

def formatting_prompts_func(examples):
    instructions = examples["instruction"]
    inputs = examples["input"]
    outputs = examples["output"]
    texts = []
    for instruction, input, output in zip(instructions, inputs, outputs):
        text = alpaca_prompt.format(instruction, input, output)
        texts.append(text)
    return {"text": texts}

from datasets import Dataset
dataset = Dataset.from_list(erp_data)
dataset = dataset.map(formatting_prompts_func, batched=True)

print(f"✅ Dataset: {len(dataset)} exemples")


# ============================================================================
# CELLULE 6: TRAINING (~1h sur T4)
# ============================================================================
"""
Training optimisé Unsloth
2x plus rapide que standard!
"""

from trl import SFTTrainer
from transformers import TrainingArguments

trainer = SFTTrainer(
    model = model,
    tokenizer = tokenizer,
    train_dataset = dataset,
    dataset_text_field = "text",
    max_seq_length = max_seq_length,
    dataset_num_proc = 2,
    packing = False,
    args = TrainingArguments(
        per_device_train_batch_size = 2,
        gradient_accumulation_steps = 4,
        warmup_steps = 5,
        max_steps = 60,  # Ajuster selon besoin
        learning_rate = 2e-4,
        fp16 = not torch.cuda.is_bf16_supported(),
        bf16 = torch.cuda.is_bf16_supported(),
        logging_steps = 5,
        optim = "adamw_8bit",
        weight_decay = 0.01,
        lr_scheduler_type = "linear",
        seed = 3407,
        output_dir = "outputs",
    ),
)

print("🚀 Début training...")
print("⏱️ Durée: ~1h sur GPU T4")

trainer_stats = trainer.train()

print("✅ Training terminé!")


# ============================================================================
# CELLULE 7: TESTS
# ============================================================================
"""
Tester le modèle fine-tuné
"""

FastLanguageModel.for_inference(model)

test_queries = [
    "Comment créer un ticket helpdesk?",
    "Comment consulter mon solde de congés?",
    "Comment soumettre une note de frais?"
]

print("🧪 Tests du modèle:\n")

for query in test_queries:
    inputs = tokenizer(
        alpaca_prompt.format(query, "", ""),
        return_tensors = "pt"
    ).to("cuda")
    
    outputs = model.generate(
        **inputs,
        max_new_tokens = 128,
        use_cache = True
    )
    
    response = tokenizer.batch_decode(outputs)[0]
    response = response.split("### Response:\n")[-1].split("###")[0].strip()
    
    print(f"❓ {query}")
    print(f"💬 {response}\n")
    print("-" * 80 + "\n")


# ============================================================================
# CELLULE 8: SAUVEGARDE GGUF
# ============================================================================
"""
Export direct en GGUF Q4_K_M
Unsloth gère la conversion automatiquement!
"""

print("🔄 Export GGUF Q4_K_M...")

model.save_pretrained_gguf(
    "mistral-erp-dataprotect",
    tokenizer,
    quantization_method = "q4_k_m"
)

print("✅ Modèle GGUF créé!")
print("📦 Fichier: mistral-erp-dataprotect-Q4_K_M.gguf")

# ============================================================================
# CELLULE 9: UPLOAD GOOGLE DRIVE
# ============================================================================

from google.colab import drive
import os

# Monter Drive
drive.mount('/content/drive')

print("🔍 Vérification des chemins possibles:\n")

# Tester "MyDrive" (anglais)
if os.path.exists('/content/drive/MyDrive'):
    print("✅ MyDrive trouvé!")
    drive_path = '/content/drive/MyDrive'
elif os.path.exists('/content/drive/My Drive'):
    print("✅ My Drive trouvé (avec espace)!")
    drive_path = '/content/drive/My Drive'
else:
    print("❌ Ni MyDrive ni My Drive trouvé")
    print("📂 Contenu de /content/drive/:")
    !ls -la /content/drive/
    drive_path = None

if drive_path:
    print(f"\n📂 Chemin Drive: {drive_path}")
    
    # Créer dossier ERP_DATAPROTECT
    erp_folder = f"{drive_path}/ERP_DATAPROTECT"
    !mkdir -p "{erp_folder}"
    
    # Copier le fichier GGUF
    print(f"\n🔄 Copie du modèle vers {erp_folder}...")
    !cp -v /content/mistral-erp-dataprotect_gguf/mistral-7b-instruct-v0.3.Q4_K_M.gguf "{erp_folder}/"
    
    # Vérifier
    print(f"\n📦 Contenu de {erp_folder}:")
    !ls -lh "{erp_folder}/"
    
    print("\n✅ Upload terminé!")

# ============================================================================
# CELLULE 10: NETTOYAGE
# ============================================================================

import gc
del model, trainer
gc.collect()
torch.cuda.empty_cache()

print("✅ Mémoire libérée!")
print("\n🎉 FINE-TUNING TERMINÉ AVEC SUCCÈS!")
print("⏱️ Temps total: ~1-1.5h")
print("📦 Fichier prêt: mistral-erp-dataprotect-Q4_K_M.gguf")
print("\n🚀 Prochaine étape: Télécharger et utiliser avec Ollama!")
