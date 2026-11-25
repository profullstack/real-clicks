#!/bin/sh
# Deploy real-clicks on dev2 (run as anthony): pull main, install, refresh app.env from the vault,
# restart the unit, check health.
#   sh deploy/deploy.sh            # from anywhere on dev2
#   sh deploy/deploy.sh --install  # first time: units + nginx template (needs root via ssh root@localhost)
set -eu
APP=/home/anthony/www/real-clicks-app
STATE=/home/anthony/.local/share/real-clicks
NODE=/home/anthony/.local/share/mise/installs/node/24/bin
export PATH="$NODE:$PATH"

[ -d "$APP/.git" ] || git clone https://github.com/profullstack/real-clicks.git "$APP"
git -C "$APP" fetch -q origin main
git -C "$APP" reset -q --hard origin/main
cd "$APP"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

# app.env is a synced copy of the vault (logicsrc is the master), never edited by hand.
mkdir -p "$STATE"
umask 077
TMPD=$(mktemp -d "$STATE/pull.XXXXXX")
( cd "$TMPD" && logicsrc teams pull profullstack real-clicks prod >/dev/null )
if [ -s "$TMPD/.env" ]; then
  [ -f "$STATE/app.env" ] && cp "$STATE/app.env" "$STATE/app.bak-001.env"
  mv "$TMPD/.env" "$STATE/app.env"
fi
rm -rf "$TMPD"

if [ "${1:-}" = "--install" ]; then
  ssh root@localhost "install -m 0644 $APP/deploy/real-clicks.service /etc/systemd/system/real-clicks.service \
    && install -m 0644 $APP/deploy/real-clicks-day14.service /etc/systemd/system/real-clicks-day14.service \
    && install -m 0644 $APP/deploy/real-clicks-day14.timer /etc/systemd/system/real-clicks-day14.timer \
    && install -m 0644 $APP/deploy/real.clicks.nginx.conf /etc/moshpit/templates/real.clicks.conf \
    && systemctl daemon-reload && systemctl enable real-clicks && systemctl enable --now real-clicks-day14.timer"
fi
ssh root@localhost systemctl restart real-clicks
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8829/healthz >/dev/null 2>&1; then
    echo "real-clicks $(git rev-parse --short HEAD) is up"
    exit 0
  fi
  sleep 1
done
echo "real-clicks did not come up; journalctl -u real-clicks" >&2
exit 1
