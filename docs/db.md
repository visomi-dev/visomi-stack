# DB

## Installation

### Move to superuser

```bash
sudo su -l
```

### Configure Repositories (Ubuntu 22.04 / Debian 11)

```bash
# Create the file repository configuration:
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'

# Import the repository signing key:
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -

# Update the package lists:
sudo apt-get update
```

### Install Dependencies (Ubuntu 22.04 / Debian 11)

```bash
sudo apt install build-essential libpq-dev postgresql postgresql-contrib
```

### Enable PostgreSQL

```bash
sudo systemctl enable postgresql --now
```

```bash
sudo su postgres -l
psql
```

```bash
CREATE DATABASE visomi_stack;
CREATE USER visomi_stack WITH ENCRYPTED PASSWORD 'visomi_stack';
GRANT ALL PRIVILEGES ON DATABASE visomi_stack TO visomi_stack WITH GRANT OPTION;
ALTER USER visomi_stack WITH SUPERUSER;
```
