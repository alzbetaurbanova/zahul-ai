# Webhook Auto-Deploy

Automatický deploy po `git push` na `main`. Webhook listener beží ako systemd service.

## Architektúra

```
GitHub push (main)
    → HMAC-SHA256 overenie
        → deploy.sh
            ├── git pull
            ├── docker-compose build   ← starý kontajner stále beží
            ├── build OK → swap → health check (15s)
            │   └── health fail → rollback image + git reset
            └── build FAIL → git reset, produkcia nedotknutá
```

## Súbory

| Súbor | Popis |
|-------|-------|
| `webhook/webhook.py` | HTTP listener, HMAC overenie, branch filter |
| `webhook/deploy.sh` | Build, swap, health check, rollback logika |
| `webhook/webhook.service` | Systemd unit pre autostart |

## Prvotné nasadenie na server

### 1. Generuj secret

```bash
openssl rand -hex 32
# skopíruj výstup
```

### 2. Skopíruj súbory na server

```bash
scp -i G:\Repos\ssh-key-2026-04-16.key \
    webhook/deploy.sh webhook/webhook.py webhook/webhook.service \
    ubuntu@141.147.31.162:/home/ubuntu/zahul-ai/webhook/
```

### 3. Na serveri — inštalácia

```bash
ssh -i G:\Repos\ssh-key-2026-04-16.key ubuntu@141.147.31.162

chmod +x /home/ubuntu/zahul-ai/webhook/deploy.sh

# Nastav secret v systemd service
sudo nano /home/ubuntu/zahul-ai/webhook/webhook.service
# → zmeň WEBHOOK_SECRET=changeme na tvoj vygenerovaný secret

sudo cp /home/ubuntu/zahul-ai/webhook/webhook.service /etc/systemd/system/zahul-webhook.service
sudo systemctl daemon-reload
sudo systemctl enable zahul-webhook
sudo systemctl start zahul-webhook
sudo systemctl status zahul-webhook
```

### 4. Firewall — len GitHub IPs

```bash
sudo iptables -A INPUT -p tcp --dport 9000 -s 140.82.112.0/20 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 9000 -s 185.199.108.0/22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 9000 -s 192.30.252.0/22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 9000 -j DROP
sudo apt-get install iptables-persistent -y
sudo netfilter-persistent save
```

### 5. GitHub Webhook

Repo → **Settings → Webhooks → Add webhook**

| Pole | Hodnota |
|------|---------|
| Payload URL | `http://141.147.31.162:9000/hooks/zahul` |
| Content type | `application/json` |
| Secret | tvoj vygenerovaný secret |
| Events | `Just the push event` |

## Logy

```bash
# Deploy logy
tail -f /home/ubuntu/deploy.log

# Webhook service logy
sudo journalctl -u zahul-webhook -f
```

## Manuálny rollback

```bash
ssh -i G:\Repos\ssh-key-2026-04-16.key ubuntu@141.147.31.162
cd ~/zahul-ai

# Pozri históriu
git log --oneline -5

# Rollback na konkrétny commit
git reset --hard <commit-sha>
docker rm -f $(docker ps -aq) 2>/dev/null
docker-compose up -d
```

## Rollback cez image (ak git reset nestačí)

```bash
# Ak existuje záloha z posledného deployu
docker rm -f $(docker ps -aq) 2>/dev/null
docker tag zahul-rollback:latest zahul-ai_zahul:latest
docker-compose up -d
```
