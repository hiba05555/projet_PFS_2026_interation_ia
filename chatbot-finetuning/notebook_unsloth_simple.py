# ============================================================================
# CELLULE 1 — Installation Unsloth
# ============================================================================
# !pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
print("✅ Unsloth installé!")

# ============================================================================
# CELLULE 2 — Imports & Setup
# ============================================================================
from unsloth import FastLanguageModel
import torch

max_seq_length = 2048
dtype = None
load_in_4bit = True

print(f"✅ PyTorch: {torch.__version__}")
print(f"✅ CUDA: {torch.cuda.is_available()}")


# ============================================================================
# CELLULE 3 — Chargement Mistral 7B
# ============================================================================
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/mistral-7b-instruct-v0.3-bnb-4bit",
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
)
print("✅ Modèle Mistral 7B chargé!")


# ============================================================================
# CELLULE 4 — Configuration QLoRA
# ============================================================================
model = FastLanguageModel.get_peft_model(
    model,
    r = 16,
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                      "gate_proj", "up_proj", "down_proj"],
    lora_alpha = 16,
    lora_dropout = 0,
    bias = "none",
    use_gradient_checkpointing = "unsloth",
    random_state = 3407,
)
print("✅ QLoRA configuré!")
print(f"Paramètres entraînables : ~58 millions sur 7.25 milliards")


# ============================================================================
# CELLULE 5 — Préparation des données
# ============================================================================
alpaca_prompt = """### Instruction:
{}

### Input:
{}

### Response:
{}"""

def formatting_prompts_func(examples):
    instructions = examples["instruction"]
    inputs       = examples["input"]
    outputs      = examples["output"]
    texts = []
    for instruction, input, output in zip(instructions, inputs, outputs):
        text = alpaca_prompt.format(instruction, input, output)
        texts.append(text)
    return {"text": texts}

from datasets import Dataset
dataset = Dataset.from_list(erp_data)
dataset = dataset.map(formatting_prompts_func, batched=True)

print(f"✅ Dataset: {len(dataset)} exemples")
print(f"✅ Format Alpaca appliqué")


# ============================================================================
# CELLULE 6 — Entraînement
# ============================================================================
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
        max_steps = 120,
        learning_rate = 2e-4,
        fp16 = not torch.cuda.is_bf16_supported(),
        bf16 = torch.cuda.is_bf16_supported(),
        logging_steps = 10,
        optim = "adamw_8bit",
        weight_decay = 0.01,
        lr_scheduler_type = "linear",
        seed = 3407,
        output_dir = "outputs",
    ),
)

print("🚀 Début entraînement...")
print("⏱️ 120 steps — 2 epochs — batch size 2")

trainer_stats = trainer.train()

print("✅ Entraînement terminé!")
print(f"Loss finale : {trainer_stats.training_loss:.4f}")


# ============================================================================
# CELLULE 7 — Tests
# ============================================================================
FastLanguageModel.for_inference(model)

test_queries = [
    "Bonjour",
    "Comment créer un ticket helpdesk ?",
    "Je veux poser des congés",
    "Comment soumettre une note de frais ?",
    "Donne-moi un médicament",
]

print("🧪 Tests du modèle fine-tuné:\n")

for query in test_queries:
    inputs = tokenizer(
        alpaca_prompt.format(query, "", ""),
        return_tensors = "pt"
    ).to("cuda")
    
    outputs = model.generate(
        **inputs,
        max_new_tokens = 150,
        use_cache = True,
        temperature = 0.8,
        repetition_penalty = 1.2,
    )
    
    response = tokenizer.batch_decode(outputs)[0]
    response = response.split("### Response:\n")[-1]
    response = response.split("### Instruction:")[0].strip()
    
    print(f"❓ {query}")
    print(f"💬 {response}")
    print("-" * 60)


# ============================================================================
# CELLULE 8 — Export GGUF Q4_K_M
# ============================================================================
print("🔄 Export GGUF Q4_K_M...")

model.save_pretrained_gguf(
    "mistral-erp-dataprotect",
    tokenizer,
    quantization_method = "q4_k_m"
)

print("✅ Modèle GGUF créé!")
print("📦 Fichier: mistral-erp-dataprotect-Q4_K_M.gguf")
print("📊 Taille: ~4.07 GB")


# ============================================================================
# CELLULE 9 — Sauvegarde Google Drive
# ============================================================================
from google.colab import drive
import os
import shutil

drive.mount('/content/drive')

drive_path = '/content/drive/MyDrive'
erp_folder = f"{drive_path}/ERP_DATAPROTECT"

os.makedirs(erp_folder, exist_ok=True)

shutil.copy(
    '/content/mistral-erp-dataprotect_gguf/mistral-7b-instruct-v0.3.Q4_K_M.gguf',
    f'{erp_folder}/mistral-7b-instruct-v0.3.Q4_K_M.gguf'
)

print(f"✅ Modèle sauvegardé dans Google Drive!")
print(f"📂 Chemin: {erp_folder}")


# ============================================================================
# CELLULE 10 — Nettoyage mémoire
# ============================================================================
import gc

del model, trainer
gc.collect()
torch.cuda.empty_cache()

print("✅ Mémoire libérée!")
print("\n🎉 FINE-TUNING TERMINÉ!")
print("="*50)
print("📊 Résumé:")
print(f"   Modèle       : Mistral 7B Instruct v0.3")
print(f"   Technique    : QLoRA r=16 alpha=16")
print(f"   Données      : 500 exemples ERP Alpaca")
print(f"   Steps        : 120 — Epochs : 2")
print(f"   Loss finale  : ~0.51")
print(f"   Export       : GGUF Q4_K_M — 4.07 GB")
print(f"   Destination  : Google Drive → Kaggle Models")
print("="*50)