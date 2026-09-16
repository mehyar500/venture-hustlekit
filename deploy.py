#!/usr/bin/env python3
"""
HustleKit deploy script — deploys this project to Cloudflare Pages WITHOUT GitHub Actions.

Usage:  python3 deploy.py            (from the project root)

What it does:
  1. Stages a clean copy of the project in /tmp/ck-deploy
  2. Mints a short-lived, scoped Cloudflare API token (Pages Write +
     Memberships Read + User Details Read) using the global admin credential.
     The raw token value is NEVER printed, logged, or written to disk — it is
     passed to wrangler only via the child process environment.
  3. Runs `wrangler pages deploy public --project-name=crayonkid --branch=main`
     with CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID set.

Safety note: `wrangler pages deploy` replaces the Pages project's env vars with
wrangler.toml [vars]. That is safe here because this project has NO [vars] at
all. IMPORTANT (verified 2026-09-14): a deploy WIPES plain_text dashboard env
vars but PRESERVES secret_text ones. The transactional-email credentials
(CLOUDFLARE_EMAIL, CF_EMAIL_ACCOUNT_ID, CF_EMAIL_GLOBAL_KEY) are therefore
stored as secret_text on the crayonkid project — do NOT convert them to
plain_text or the next deploy will drop them. New secret vars also require a
redeploy to bind. Never use this pattern on a project whose secrets live only
in the dashboard (e.g. mehyar-web).

Requires: node + npm, and `wrangler` (installed automatically if missing).
"""
import json, os, shutil, subprocess, sys

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
STAGE_DIR = "/tmp/hk-deploy"
PROJECT_NAME = "hustlekit"
ACCOUNT_ID = "621600637337cc1c9ecb7095508bc732"

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc
import urllib.request, urllib.error

EMAIL = json.load(open("/home/hatch/workspace/skills/cloudflare/config.json")).get("email")


def cf(path, method="GET", body=None):
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4" + path, method=method,
        headers={"X-Auth-Email": EMAIL, "Accept": "application/json",
                 "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    dc.add_surrogate_to_request(req, "custom.cloudflare", allowed_hosts=["api.cloudflare.com"])
    try:
        with urllib.request.urlopen(req, data=data, timeout=60) as resp:
            return resp.status, dc.read_json_response(resp)
    except urllib.error.HTTPError as e:
        return e.code, {"http_error": e.code,
                        "body": e.read(2000).decode("utf-8", "replace")}


def mint_deploy_token():
    import datetime
    expires = (datetime.datetime.now(datetime.timezone.utc) +
               datetime.timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    s, d = cf("/user/tokens", "POST", {
        "name": "hustlekit-pages-deploy",
        "expires_on": expires,  # 2026-09-16 quota lesson: short-lived tokens
        "policies": [
            {"effect": "allow",
             "resources": {"com.cloudflare.api.account." + ACCOUNT_ID: "*"},
             "permission_groups": [
                 {"id": "8d28297797f24fb8a0c332fe0866ec89"},  # Pages Write
                 {"id": "3518d0f75557482e952c6762d3e64903"},  # Memberships Read
             ]},
            {"effect": "allow",
             "resources": {"com.cloudflare.api.user.1e1235d798707498a0b23a4cf83ecd0b": "*"},
             "permission_groups": [
                 {"id": "8acbe5bb0d54464ab867149d7f7cf8ac"},  # User Details Read
             ]},
        ],
        "not_before": "2026-09-14T00:00:00Z",
    })
    tok = ((d.get("result") or {}).get("value"))
    tok_id = ((d.get("result") or {}).get("id"))
    if s != 200 or not tok:
        print("TOKEN MINT FAILED", s, json.dumps(d)[:300])
        sys.exit(1)
    print("deploy token minted (value redacted)")
    return tok, tok_id


def ensure_wrangler():
    if shutil.which("wrangler"):
        return
    print("installing wrangler@3 ...")
    r = subprocess.run(["npm", "install", "-g", "wrangler@3"],
                       capture_output=True, text=True, timeout=600)
    if r.returncode != 0 or not shutil.which("wrangler"):
        print("wrangler install failed")
        sys.exit(1)


def main():
    # 1. stage — per AGENTS.md: stage the SITE ROOT, not the project dir.
    # wrangler pages deploy <dir> serves <dir> as the site root. Deploying
    # the "public" subdir puts functions/ out of reach. Instead, copy
    # public/* to the stage root AND functions/ to the stage root.
    if os.path.isdir(STAGE_DIR):
        shutil.rmtree(STAGE_DIR)
    os.makedirs(STAGE_DIR)
    # Copy public/* to stage root
    public_src = os.path.join(PROJECT_ROOT, "public")
    for item in os.listdir(public_src):
        s = os.path.join(public_src, item)
        d = os.path.join(STAGE_DIR, item)
        if os.path.isdir(s):
            shutil.copytree(s, d)
        else:
            shutil.copy2(s, d)
    # Copy functions/ to stage root
    func_src = os.path.join(PROJECT_ROOT, "functions")
    if os.path.isdir(func_src):
        shutil.copytree(func_src, os.path.join(STAGE_DIR, "functions"))
    # Copy lib/ to stage root (functions import from ../../lib/)
    lib_src = os.path.join(PROJECT_ROOT, "lib")
    if os.path.isdir(lib_src):
        shutil.copytree(lib_src, os.path.join(STAGE_DIR, "lib"))
    # Copy wrangler.toml if it exists (for bindings config)
    wt = os.path.join(PROJECT_ROOT, "wrangler.toml")
    if os.path.isfile(wt):
        shutil.copy2(wt, os.path.join(STAGE_DIR, "wrangler.toml"))
    print("staged ->", STAGE_DIR)

    # 2. token
    token, token_id = mint_deploy_token()

    # 3. deploy — deploy the STAGE ROOT (which now has public/* + functions/)
    ensure_wrangler()
    env = dict(os.environ)
    env["CLOUDFLARE_API_TOKEN"] = token
    env["CLOUDFLARE_ACCOUNT_ID"] = ACCOUNT_ID
    env["WRANGLER_SEND_METRICS"] = "false"
    del token
    p = subprocess.run(
        ["wrangler", "pages", "deploy", ".",
         "--project-name=" + PROJECT_NAME, "--branch=main"],
        cwd=STAGE_DIR, env=env, capture_output=True, text=True, timeout=600)
    print(p.stdout[-2500:])
    if p.stderr:
        print(p.stderr[-1000:])
    # 4. self-clean the deploy token (2026-09-16 quota lesson: account caps at
    #    50 tokens; a leaked token per deploy eventually kills deploys)
    try:
        s, _ = cf(f"/user/tokens/{token_id}", "DELETE")
        print("deploy token revoked:", s)
    except Exception as e:
        print("token revoke failed (expires in 3h anyway):", e)
    sys.exit(p.returncode)


if __name__ == "__main__":
    main()
