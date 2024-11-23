# DB

## Installation

### Configure Repositories (Debian 11)

```bash
sudo apt-get install lsb-release curl gpg
curl -fsSL https://packages.redis.io/gpg | sudo gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
sudo chmod 644 /usr/share/keyrings/redis-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list
```

### Install Dependencies (Ubuntu 22.04 / Debian 11)

```bash
sudo apt-get update
sudo apt-get install redis-stack-server
```

### Enable PostgreSQL

```bash
systemctl enable postgresql --now
```

```bash
sudo su -l postgres
psql
```

```bash
CREATE DATABASE visomi;
CREATE USER visomi WITH ENCRYPTED PASSWORD 'visomi';
GRANT ALL PRIVILEGES ON DATABASE visomi TO visomi WITH GRANT OPTION;
ALTER USER visomi WITH SUPERUSER;
```
