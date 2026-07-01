#!/bin/sh
set -e

ollama serve &
SERVE_PID=$!

# attendre que le serveur soit prêt
until ollama list >/dev/null 2>&1; do
  sleep 1
done

if ! ollama list | grep -q erp-dataprotect; then
  echo "Creating model erp-dataprotect..."
  ollama create erp-dataprotect -f /models/Modelfile
else
  echo "Model erp-dataprotect already exists, skipping create."
fi

wait $SERVE_PID