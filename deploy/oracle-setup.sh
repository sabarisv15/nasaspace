#!/bin/sh
# One-time setup of a fresh Oracle Cloud Ubuntu VM (Always Free, Ampere A1 / ARM or AMD) for ARCNAVE.
# Run on the VM:   sh oracle-setup.sh
# It installs Docker, opens ports 80/443 in the VM's own firewall (Oracle's Ubuntu images block them by default),
# and adds a small swap file. Safe to run twice.
set -e

echo "== 1/4 System update"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

echo "== 2/4 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sudo sh /tmp/get-docker.sh
fi
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker

echo "== 3/4 Firewall: open 80 and 443 (Oracle images REJECT everything except SSH)"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent netfilter-persistent
for p in 80 443; do
  if ! sudo iptables -C INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 6 -p tcp -m state --state NEW --dport "$p" -j ACCEPT
  fi
done
sudo netfilter-persistent save

echo "== 4/4 Swap (2 GB), so builds never run out of memory"
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo
echo "Done. Log out and log in again (so 'docker' works without sudo), then follow docs/deploy/DEPLOY-DOCKER-ORACLE.md step 6."
echo "Also open ports 80 and 443 in the Oracle console (VCN > Security List > Ingress rules), see docs/deploy/DEPLOY-DOCKER-ORACLE.md step 3."
