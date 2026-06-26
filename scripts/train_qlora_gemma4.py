# QLoRA fine-tune of Gemma 4 31B on a single RTX 5090 (32 GB, Blackwell sm_120).
#
# This is the LOCAL test-run trainer. The final run will be redone properly on
# AWS; here we just compare quality across the 50M / 100M / 200M dataset sizes.
#
# ─────────────────────────────────────────────────────────────────────────────
# SETUP (Blackwell is bleeding-edge — the standard `pip install unsloth` will
# OOM on 31B because it lacks the Blackwell kernels). Verified config, from
# unsloth issue #5154 (Gemma 4 31B QLoRA on a 5090):
#
#   curl -fsSL https://unsloth.ai/install.sh | sh      # Unsloth STUDIO (not pip)
#   # inside the Studio venv:
#   pip install --upgrade "torch==2.11.0+cu129" --index-url https://download.pytorch.org/whl/cu129
#   pip install --upgrade transformers            # needs >=5.5.3 for gemma4
#   # bitsandbytes 0.49.2 ships with Studio; keep CUDA 12.9 (cu130 breaks the bnb ABI)
#   # if you hit phantom OOM / Triton errors:  rm -rf /tmp/unsloth_compiled_cache/
#
# Gotchas baked into the config below:
#   • attn_implementation="sdpa"  — FlashAttention2 rejects Gemma 4's 256+512
#     head dims ("head dimension at most 256").
#   • load_in_4bit=True           — QLoRA; full fine-tune of 31B needs ~500GB, no.
#   • gradient_checkpointing="unsloth" + small batch — keeps 31B under 32 GB.
#   • max_seq_length must stay modest: ~22 GB was measured at 512 tokens. 4096 is
#     a reasonable ceiling for roleplay on 32 GB; raise cautiously and watch VRAM.
# ─────────────────────────────────────────────────────────────────────────────
#
# Usage:
#   python scripts/train_qlora_gemma4.py \
#       --data "../training-data/latest.jsonl" \
#       --out  "../training-data/out-run1-50m" \
#       --seq-len 4096 --epochs 1

import argparse, os

p = argparse.ArgumentParser()
p.add_argument("--data", default=os.path.join("..", "training-data", "latest.jsonl"))
p.add_argument("--out", default=os.path.join("..", "training-data", "out-gemma4-31b"))
p.add_argument("--model", default="unsloth/gemma-4-31B-it-unsloth-bnb-4bit")
p.add_argument("--seq-len", type=int, default=4096)
p.add_argument("--epochs", type=float, default=1.0)
p.add_argument("--batch", type=int, default=2)
p.add_argument("--grad-accum", type=int, default=4)
p.add_argument("--lora-r", type=int, default=16)
p.add_argument("--lora-alpha", type=int, default=16)
p.add_argument("--lr", type=float, default=2e-4)
args = p.parse_args()

# Import unsloth FIRST — it patches transformers/trl for the Blackwell kernels.
from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template, train_on_responses_only
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig
import torch

print(f"CUDA: {torch.version.cuda} | device: {torch.cuda.get_device_name(0)} "
      f"| bf16: {torch.cuda.is_bf16_supported()}")

# ── model + LoRA ──────────────────────────────────────────────────────────────
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=args.model,
    max_seq_length=args.seq_len,
    load_in_4bit=True,                 # QLoRA
    dtype=None,                        # auto (bf16 on Blackwell)
    attn_implementation="sdpa",        # FA2 rejects Gemma 4 head dims
)

model = FastLanguageModel.get_peft_model(
    model,
    r=args.lora_r,
    lora_alpha=args.lora_alpha,
    lora_dropout=0.0,
    bias="none",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                    "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth",   # the 32 GB lifesaver
    random_state=3407,
)

tokenizer = get_chat_template(tokenizer, chat_template="gemma-4")

# ── data: our exported chat-format JSONL ({"messages":[{role,content}...]}) ────
def fmt(ex):
    # Gemma has no system role — the template folds it into the first turn.
    text = tokenizer.apply_chat_template(ex["messages"], tokenize=False,
                                         add_generation_prompt=False)
    return {"text": text}

ds = load_dataset("json", data_files=args.data, split="train").map(fmt)
print(f"Dataset: {len(ds)} samples from {args.data}")

# ── train ─────────────────────────────────────────────────────────────────────
trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=ds,
    args=SFTConfig(
        dataset_text_field="text",
        max_seq_length=args.seq_len,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        warmup_ratio=0.03,
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        bf16=True,
        logging_steps=5,
        optim="adamw_8bit",            # 8-bit optimizer = less VRAM
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        seed=3407,
        output_dir=args.out,
        report_to="none",
    ),
)

# Compute loss ONLY on the model's replies (mask the user/card tokens) — the
# right objective for roleplay: learn to RESPOND, not to parrot the prompt.
trainer = train_on_responses_only(
    trainer,
    instruction_part="<start_of_turn>user\n",
    response_part="<start_of_turn>model\n",
)

trainer.train()

# Save the LoRA adapter (small). Merge to a full model only when you ship.
model.save_pretrained(args.out)
tokenizer.save_pretrained(args.out)
print(f"Saved LoRA adapter → {args.out}")
print("Merge for inference with: model.save_pretrained_merged(out, tokenizer, save_method='merged_16bit')")
