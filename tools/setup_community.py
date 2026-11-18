#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""官网售后社群自动配置与 Telegram 官方 Bot API 建群工具。

用法：
    python3 tools/setup_community.py                # 同步微信配置 + 为当前产品自动创建 TG Topic 与永久邀请码
    python3 tools/setup_community.py --init-config  # 在 ~/.config/aic/community.env 生成全局凭据模板
    python3 tools/setup_community.py --offline-only # 仅同步本地微信名片/微信号并补全本地 QR SVG（不发网络请求）
    python3 tools/setup_community.py --recreate     # 强制重新创建 TG Topic 与邀请链接
    python3 tools/setup_community.py --mock-api     # 离线 Mock 模式，用于本地校验完整建群与配置写入闭环

凭据读取优先级：环境变量 > ~/.config/aic/community.env
    AIC_WECHAT_ID         开发者个人微信号
    AIC_WECHAT_QR         个人微信永久名片码路径（默认 ~/.config/aic/wechat-qr.png）
    AIC_TG_BOT_TOKEN      Telegram @BotFather 申请的 Bot Token
    AIC_TG_CHAT_ID        开启了 Topics 的品牌大本营 Supergroup ID（如 -1001234567890）
    AIC_TG_GROUP_USERNAME 可选，公开大本营用户名（如 blakeslab），用于拼接直达 Topic 链接
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
CONF_PATH = os.path.join(ROOT, "site.config.json")
DEFAULT_ENV_PATH = os.path.expanduser("~/.config/aic/community.env")
DEFAULT_WECHAT_QR = os.path.expanduser("~/.config/aic/wechat-qr.png")

if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)

import qr_svg  # noqa: E402


ENV_TEMPLATE = """# aic 全局售后社群凭据（一次配置，所有新建官网自动复用）
# 权限建议保持 0600，切勿提交到任何 Git 仓库。

# ── 中国大陆：个人微信永久名片（用户扫码加好友备注产品暗号，再手动拉群） ──
AIC_WECHAT_ID=""
AIC_WECHAT_QR="~/.config/aic/wechat-qr.png"

# ── 海外：Telegram 单品牌总群（开启 Topics）+ 官方 Bot API 自动开分群 ──
# 1) 在 Telegram 找 @BotFather 新建 Bot 拿到 Token
# 2) 新建 1 个群 → 打开「Topics 话题」→ 设为超级群并把 Bot 设为管理员
#    （授予「Manage Topics」和「Invite Users via Link」权限）
AIC_TG_BOT_TOKEN=""
AIC_TG_CHAT_ID=""
# 若为公开群可填用户名（不带 @），会自动生成话题直达链接 https://t.me/<username>/<topic_id>
AIC_TG_GROUP_USERNAME=""
"""


def init_config(env_path: str) -> None:
    cfg_dir = os.path.dirname(env_path)
    os.makedirs(cfg_dir, exist_ok=True)
    if os.path.exists(env_path):
        print(f"ℹ 全局配置文件已存在：{env_path}")
        return
    with open(env_path, "w", encoding="utf-8") as f:
        f.write(ENV_TEMPLATE)
    os.chmod(env_path, 0o600)
    print(f"✅ 已生成全局社群凭据模板（权限 0600）：{env_path}")
    print(f"   请填入 AIC_WECHAT_ID / AIC_TG_BOT_TOKEN / AIC_TG_CHAT_ID，")
    print(f"   并可将个人微信二维码放至 {DEFAULT_WECHAT_QR}。")


def load_env(env_path: str) -> dict[str, str]:
    """解析 community.env 并叠加进程环境变量（环境变量优先）。"""
    data: dict[str, str] = {}
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[len("export "):].strip()
                if "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
                    v = v[1:-1]
                data[k] = os.path.expanduser(v)

    for key in (
        "AIC_WECHAT_ID",
        "AIC_WECHAT_QR",
        "AIC_TG_BOT_TOKEN",
        "AIC_TG_CHAT_ID",
        "AIC_TG_GROUP_USERNAME",
    ):
        if key in os.environ and os.environ[key] != "":
            data[key] = os.path.expanduser(os.environ[key])
    return data


def load_raw_conf() -> dict:
    if not os.path.exists(CONF_PATH):
        sys.exit(f"❌ 找不到 {CONF_PATH}")
    with open(CONF_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_raw_conf(conf: dict) -> None:
    """原样保留 `//` 注释键写回 site.config.json。"""
    with open(CONF_PATH, "w", encoding="utf-8") as f:
        json.dump(conf, f, ensure_ascii=False, indent=2)
        f.write("\n")


def ensure_community_shape(conf: dict) -> dict:
    site = conf.get("site", {})
    raw_name = site.get("name", "")
    zh_name = raw_name.get("zh-CN", "") if isinstance(raw_name, dict) else str(raw_name)
    en_name = (
        raw_name.get("en", "")
        if isinstance(raw_name, dict)
        else ((site.get("altNames") or [""])[0] or zh_name)
    )
    comm = conf.setdefault("community", {})
    wc = comm.setdefault("wechat", {})
    wc.setdefault("id", "")
    wc.setdefault("qrImage", "wechat-qr.png")
    wc.setdefault("remark", zh_name or en_name or "")

    tg = comm.setdefault("telegram", {})
    tg.setdefault("inviteUrl", "")
    tg.setdefault("topicId", 0)
    tg.setdefault("topicUrl", "")
    tg.setdefault("groupName", f"{en_name or zh_name} Community".strip())
    tg.setdefault("qrImage", "telegram-qr.svg")
    return conf


def _first_ascii(items) -> str:
    for x in items or []:
        s = str(x).strip()
        if s and s.isascii():
            return s
    return ""


def extract_names(conf: dict) -> tuple[str, str]:
    site = conf.get("site", {})
    raw_name = site.get("name", "")
    alts = site.get("altNames") or []
    ascii_alt = _first_ascii(alts)
    if isinstance(raw_name, dict):
        zh = (raw_name.get("zh-CN") or next(iter(raw_name.values()), "")).strip()
        en = (raw_name.get("en") or ascii_alt or (alts[0] if alts else "") or zh).strip()
    else:
        zh = str(raw_name).strip()
        en = (ascii_alt or (alts[0] if alts else "") or zh).strip()
    return zh or en or "App", en or zh or "App"


def sync_wechat(conf: dict, env: dict[str, str]) -> bool:
    """同步个人微信号与本地永久微信二维码，返回配置是否发生变化。"""
    changed = False
    wc = conf["community"]["wechat"]
    if wc.get("enabled", True) is False:
        return False
    wx_id = (env.get("AIC_WECHAT_ID") or "").strip()
    if wx_id and wc.get("id") != wx_id:
        wc["id"] = wx_id
        changed = True
        print(f"  ✎ 已写入个人微信号：community.wechat.id = {wx_id}")

    src_qr = (env.get("AIC_WECHAT_QR") or "").strip() or DEFAULT_WECHAT_QR
    if src_qr and os.path.isfile(src_qr):
        dst_name = wc.get("qrImage") or "wechat-qr.png"
        dst_path = os.path.join(ROOT, dst_name)
        if os.path.abspath(src_qr) != os.path.abspath(dst_path):
            shutil.copy2(src_qr, dst_path)
            print(f"  ✎ 已复制个人微信二维码：{src_qr} → {dst_name}")
    return changed


def tg_api_call(
    token: str,
    method: str,
    payload: dict,
    mock: bool = False,
) -> dict:
    """调用 Telegram Bot API（标准库 urllib，零外部依赖；支持 --mock-api 离线桩）。"""
    if mock:
        if method == "createForumTopic":
            return {
                "ok": True,
                "result": {
                    "message_thread_id": 2048,
                    "name": payload.get("name", "Community"),
                },
            }
        if method == "createChatInviteLink":
            return {
                "ok": True,
                "result": {
                    "invite_link": "https://t.me/+MockCommunityInvite2026",
                    "name": payload.get("name", "Official Site"),
                },
            }
        if method == "sendMessage":
            return {"ok": True, "result": {"message_id": 9001}}
        if method == "pinChatMessage":
            return {"ok": True, "result": True}
        if method == "editForumTopic":
            return {"ok": True, "result": True}
        if method == "getForumTopicIconStickers":
            return {
                "ok": True,
                "result": [
                    {"emoji": "👑", "custom_emoji_id": "5357107601584693888"},
                    {"emoji": "👶", "custom_emoji_id": "5377675010259297233"},
                    {"emoji": "🧠", "custom_emoji_id": "5237889595894414384"},
                    {"emoji": "🛍", "custom_emoji_id": "5350699789551935589"},
                    {"emoji": "🍽", "custom_emoji_id": "5350344462612570293"},
                    {"emoji": "📈", "custom_emoji_id": "5350305691942788490"},
                    {"emoji": "💎", "custom_emoji_id": "5309958691854754293"},
                    {"emoji": "💬", "custom_emoji_id": "5417915203100613993"},
                ],
            }
        return {"ok": True, "result": {}}

    url = f"https://api.telegram.org/bot{token}/{method}"
    body = json.dumps(payload).encode("utf-8")
    last_err: Exception | None = None
    data = None
    for attempt in range(1, 5):
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Telegram API {method} HTTP {e.code}: {err_body}") from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = e
            if attempt < 4:
                time.sleep(1.0 * attempt)
    if data is None:
        reason = getattr(last_err, "reason", last_err)
        raise RuntimeError(f"Telegram API {method} 网络请求失败: {reason}") from last_err

    if not data.get("ok"):
        raise RuntimeError(f"Telegram API {method} 返回错误: {data}")
    return data


_TOPIC_ICON_RULES: list[tuple[tuple[str, ...], str]] = [
    (("game", "king", "crown", "royal", "conquest", "versailles", "louis"), "👑"),
    (("baby", "kid", "child", "parent", "family", "nurture", "grow"), "👶"),
    (("note", "brain", "study", "book", "learn", "knowledge", "accrue"), "🧠"),
    (("dress", "fashion", "outfit", "closet", "wardrobe", "shop"), "🛍"),
    (("food", "meal", "fridge", "recipe", "cook", "kitchen", "eat", "chi"), "🍽"),
    (("watch", "analytics", "chart", "finance", "sales", "app store", "asc", "track"), "📈"),
]


def _pick_topic_emoji(conf: dict, en_name: str) -> str:
    tg = (conf.get("community") or {}).get("telegram") or {}
    explicit = (tg.get("topicEmoji") or "").strip()
    if explicit:
        return explicit
    site = conf.get("site") or {}
    raw_desc = site.get("description", "")
    desc = raw_desc.get("en", "") if isinstance(raw_desc, dict) else str(raw_desc)
    haystack = f"{en_name} {desc}".lower()
    for keywords, emoji in _TOPIC_ICON_RULES:
        if any(k in haystack for k in keywords):
            return emoji
    return "💎"


def resolve_topic_icon_id(
    token: str,
    conf: dict,
    en_name: str,
    mock: bool = False,
) -> tuple[str, str]:
    """从官方免费 Topic 图标集合 (getForumTopicIconStickers) 匹配最贴合产品品类的图标。"""
    tg = (conf.get("community") or {}).get("telegram") or {}
    override_id = (tg.get("iconCustomEmojiId") or "").strip()
    preferred_emoji = _pick_topic_emoji(conf, en_name)
    if override_id:
        return preferred_emoji, override_id
    try:
        stickers = tg_api_call(token, "getForumTopicIconStickers", {}, mock=mock).get("result") or []
    except RuntimeError as e:
        print(f"  ⚠ 获取官方 Topic 图标列表失败，将使用默认首字母盾牌（{e}）")
        return "", ""

    by_emoji = {
        str(s.get("emoji") or "").strip(): str(s.get("custom_emoji_id") or "").strip()
        for s in stickers
        if s.get("custom_emoji_id")
    }
    for candidate in (preferred_emoji, "💎", "💬"):
        if candidate in by_emoji:
            return candidate, by_emoji[candidate]
    if stickers and stickers[0].get("custom_emoji_id"):
        return str(stickers[0].get("emoji") or ""), str(stickers[0]["custom_emoji_id"])
    return "", ""


def sync_telegram(
    conf: dict,
    env: dict[str, str],
    offline_only: bool,
    recreate: bool,
    mock_api: bool,
    sync_icon: bool = False,
) -> bool:
    changed = False
    tg = conf["community"]["telegram"]
    qr_rel = tg.get("qrImage") or "telegram-qr.svg"
    qr_abs = os.path.join(ROOT, qr_rel)

    existing_url = (tg.get("inviteUrl") or "").strip()
    existing_tid = int(tg.get("topicId") or 0)
    token = (env.get("AIC_TG_BOT_TOKEN") or "").strip()
    chat_id = (env.get("AIC_TG_CHAT_ID") or "").strip()
    _zh_name, en_name = extract_names(conf)

    # 离线模式或幂等命中：仅确保本地矢量二维码存在，按需补齐 Topic 图标
    if offline_only or (not recreate and existing_tid > 0 and existing_url.startswith("https://t.me/")):
        if existing_url.startswith("https://t.me/") and not os.path.exists(qr_abs):
            qr_svg.generate_qr_svg(existing_url, qr_abs)
            print(f"  ✎ 已离线补生成 Telegram 二维码：{qr_rel}")
        elif not offline_only and existing_tid > 0 and existing_url:
            if (sync_icon or not (tg.get("iconCustomEmojiId") or "").strip()) and (mock_api or (token and chat_id)):
                emoji, icon_id = resolve_topic_icon_id(token or "mock-token", conf, en_name, mock=mock_api)
                if icon_id:
                    try:
                        tg_api_call(
                            token or "mock-token",
                            "editForumTopic",
                            {
                                "chat_id": chat_id or "-1001234567890",
                                "message_thread_id": existing_tid,
                                "icon_custom_emoji_id": icon_id,
                            },
                            mock=mock_api,
                        )
                        tg["topicEmoji"] = emoji
                        tg["iconCustomEmojiId"] = icon_id
                        changed = True
                        print(f"  ✓ 已为现有 Topic (#{existing_tid}) 补齐 3D 图标：{emoji} ({icon_id})")
                        return changed
                    except RuntimeError as e:
                        print(f"  ⚠ 更新 Topic 图标失败（{e}）")
            print(f"  ✓ 已有 Telegram Topic (#{existing_tid}) 与邀请链接，跳过重复创建（重创加 --recreate）")
        return changed

    if not mock_api and (not token or not chat_id):
        print(
            "  ⚠ 未配置 AIC_TG_BOT_TOKEN / AIC_TG_CHAT_ID，跳过自动创建 Telegram 话题群。\n"
            f"    首次使用请运行：python3 tools/setup_community.py --init-config 并编辑 {DEFAULT_ENV_PATH}"
        )
        return changed

    if mock_api:
        token = token or "mock-token"
        chat_id = chat_id or "-1001234567890"

    topic_title = ((tg.get("topicTitle") or "").strip() or en_name)[:120]
    emoji, icon_id = resolve_topic_icon_id(token, conf, en_name, mock=mock_api)

    print(f"── 正在创建 Telegram Topic：{topic_title} ──")
    topic_payload = {"chat_id": chat_id, "name": topic_title}
    if icon_id:
        topic_payload["icon_custom_emoji_id"] = icon_id
    topic_res = tg_api_call(
        token,
        "createForumTopic",
        topic_payload,
        mock=mock_api,
    )
    topic_id = int(topic_res["result"]["message_thread_id"])

    link_res = tg_api_call(
        token,
        "createChatInviteLink",
        {"chat_id": chat_id, "name": f"{en_name} Site"[:32]},
        mock=mock_api,
    )
    invite_url = link_res["result"]["invite_link"]

    welcome = (
        f"Welcome to the {en_name} official feedback & support channel!\n\n"
        "• Report bugs (please attach your App version & device model)\n"
        "• Share feature requests — your feedback directly shapes our next release."
    )
    try:
        msg_res = tg_api_call(
            token,
            "sendMessage",
            {"chat_id": chat_id, "message_thread_id": topic_id, "text": welcome},
            mock=mock_api,
        )
        msg_id = msg_res["result"]["message_id"]
        try:
            tg_api_call(
                token,
                "pinChatMessage",
                {"chat_id": chat_id, "message_id": msg_id, "disable_notification": True},
                mock=mock_api,
            )
        except RuntimeError as e:
            print(f"  ⚠ 置顶欢迎消息跳过（{e}）")
    except RuntimeError as e:
        print(f"  ⚠ 发送欢迎消息失败（{e}）")

    username = (env.get("AIC_TG_GROUP_USERNAME") or "").strip().lstrip("@")
    topic_url = f"https://t.me/{username}/{topic_id}" if username else ""

    tg["topicId"] = topic_id
    tg["inviteUrl"] = invite_url
    tg["topicUrl"] = topic_url
    tg["groupName"] = f"{en_name} Community"
    tg["qrImage"] = qr_rel
    if emoji:
        tg["topicEmoji"] = emoji
    if icon_id:
        tg["iconCustomEmojiId"] = icon_id
    changed = True

    qr_svg.generate_qr_svg(invite_url, qr_abs)
    print(f"  ✓ Topic 已创建：topicId={topic_id}")
    print(f"  ✓ 永久邀请链接：{invite_url}")
    print(f"  ✎ 已生成矢量二维码：{qr_rel}")
    return changed


def main() -> None:
    ap = argparse.ArgumentParser(description="官网售后社群自动配置与 TG 建群")
    ap.add_argument("--config", default=DEFAULT_ENV_PATH, help="全局凭据 env 文件路径")
    ap.add_argument("--init-config", action="store_true", help="创建 ~/.config/aic/community.env 模板")
    ap.add_argument("--offline-only", action="store_true", help="仅同步本地微信与离线 QR，不联网")
    ap.add_argument("--recreate", action="store_true", help="强制重建 Telegram Topic 与邀请链接")
    ap.add_argument("--sync-icon", action="store_true", help="为已有 Telegram Topic 补全或同步 3D 图标")
    ap.add_argument("--mock-api", action="store_true", help="使用内存 Mock 替代真实 Telegram 请求")
    args = ap.parse_args()

    if args.init_config:
        init_config(args.config)
        return

    conf = ensure_community_shape(load_raw_conf())
    env = load_env(args.config)

    changed_wc = sync_wechat(conf, env)
    changed_tg = sync_telegram(
        conf,
        env,
        offline_only=args.offline_only,
        recreate=args.recreate,
        mock_api=args.mock_api,
        sync_icon=args.sync_icon,
    )

    if changed_wc or changed_tg:
        save_raw_conf(conf)
        print("  ✎ 已更新 site.config.json")


if __name__ == "__main__":
    main()
