FROM ollama/ollama:latest

COPY mistral-7b-instruct-v0.3.Q4_K_M.gguf /models/mistral-7b-instruct-v0.3.Q4_K_M.gguf
COPY Modelfile /models/Modelfile
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]