#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Analyze a local business license image (营业执照.png) with OpenAI Responses API.

Usage:
  export OPENAI_API_KEY="sk-...."
  python3 openAI/analyze_business_license.py \
    --image ~/Desktop/营业执照.png \
    --customer-name "客户名称(可选)" \
    --model gpt-5-nano

Notes:
- The script will also do a lightweight local check for "more than one image" by
  counting frames/pages via Pillow (e.g., multi-frame formats like TIFF/GIF/APNG).
- Most checks (clarity, stamp type, expiry, scope, etc.) are done by the model.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
from dataclasses import dataclass
from typing import Optional, Tuple

import requests
from PIL import Image


OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"


def _guess_mime(path: str) -> str:
    mime, _ = mimetypes.guess_type(path)
    return mime or "application/octet-stream"


def _b64_data_url(path: str) -> str:
    mime = _guess_mime(path)
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    return f"data:{mime};base64,{b64}"


def _count_frames(path: str) -> Tuple[int, str]:
    """
    Returns (frame_count, note). For most PNG/JPG it will be 1.
    """
    try:
        with Image.open(path) as im:
            n = getattr(im, "n_frames", 1)
            fmt = (im.format or "").upper()
            mode = im.mode
            size = f"{im.size[0]}x{im.size[1]}"
            note = f"format={fmt}, mode={mode}, size={size}, frames={n}"
            return int(n), note
    except Exception as e:
        return 0, f"failed_to_open_image: {e}"


def _build_prompt(customer_name: Optional[str], local_frames: int, local_note: str) -> str:
    customer_part = (
        f"客户名称（用于比对‘营业执照名称/公司名称’是否一致）：{customer_name}"
        if customer_name
        else "客户名称：未提供（涉及“是否一致”的项请输出“无法判断/缺少客户名称”并说明需要的字段）"
    )

    # Keep prompt explicit and checklist-driven.
    return f"""你是企业证照审核助手。请只基于我提供的图片内容进行判断；对无法从图片确定的项，请明确写“无法判断”并说明原因与需要补充的信息。

我将给你一张名为《营业执照.png》的图片（可能是扫描件或截图）。
本地程序检测到：是否多张图片/多页（按图片帧计数）：{local_frames}；附加信息：{local_note}

{customer_part}

请帮我分析《营业执照.png》是否符合以下标准要求，并“逐项列举结果”。输出要求：
- 用中文输出
- 按下面条目顺序逐项给出：结论（通过/不通过/无法判断）+ 依据（从图中读到的关键信息/证据）
- 对需要读取字段（如有效期、经营范围、备案/许可编号），请把你识别到的内容原样写出（不要编造）
- 如果发现疑似 P 图/篡改/遮挡/模糊，请在对应项指出风险

标准如下：

一、名称名称变更审核
1. 程序校验
• 判断是否大于一张图片

2. AI识别校验
• 判断营业执照图片是否清晰
• 判断是否为营业执照
• 判断营业执照名称与客户名称是否一致
• 判断是否为电子执照
• 非电子执照判断是否有盖章
• 判断盖章是否清晰
• 判断印章是否为公章
• 判断扫描中的公司名称与客户名称是否一致
• 判断营业执照是否过期
• 读取营业执照中的有效期信息填写在页面表单中（请输出：有效期起止/或长期等）
• 判断经营范围中是否含有“医疗器械”
• 若包含“医疗器械”，请额外输出：建议将表单中的“医疗器械”字段=勾选，否则=不勾选

二、营业执照审核
• 判断是否大于一张图片
• 判断营业执照图片是否清晰
• 判断是否为二类医疗资质（备案编号中是“经营备”/“经营许”）
"""


def call_openai_responses(api_key: str, model: str, prompt: str, image_data_url: str, store: bool = False) -> dict:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    payload = {
        "model": model,
        "store": store,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": image_data_url},
                ],
            }
        ],
        # Make outputs more deterministic for auditing.
        #"temperature": 0.2,
    }

    resp = requests.post(OPENAI_RESPONSES_URL, headers=headers, json=payload, timeout=180)
    if resp.status_code >= 400:
        raise RuntimeError(f"OpenAI API error {resp.status_code}: {resp.text}")

    return resp.json()


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze a business license image with OpenAI Responses API.")
    parser.add_argument("--image", default="~/Desktop/营业执照.png", help="Path to the image file (default: ~/Desktop/营业执照.png)")
    parser.add_argument("--customer-name", default=None, help="Customer name for consistency checks (optional).")
    parser.add_argument("--model", default="gpt-5-nano", help="Model id (default: gpt-5-nano)")
    parser.add_argument("--store", action="store_true", help="Set store=true to store response (default: false)")
    args = parser.parse_args()

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("ERROR: OPENAI_API_KEY env var is not set.\n"
              "Run: export OPENAI_API_KEY='sk-...'\n", file=sys.stderr)
        return 2

    image_path = os.path.expanduser(args.image)
    if not os.path.isfile(image_path):
        print(f"ERROR: image not found: {image_path}", file=sys.stderr)
        return 2

    frames, note = _count_frames(image_path)
    image_data_url = _b64_data_url(image_path)
    prompt = _build_prompt(args.customer_name, frames, note)

    try:
        out = call_openai_responses(api_key, args.model, prompt, image_data_url, store=args.store)
    except Exception as e:
        print(f"ERROR calling OpenAI: {e}", file=sys.stderr)
        return 1

    # The Responses API returns an 'output' array. Many SDKs provide output_text,
    # but with raw REST we extract text chunks.
    text_parts = []
    for item in out.get("output", []):
        if item.get("type") == "message":
            for c in item.get("content", []):
                if c.get("type") == "output_text" and "text" in c:
                    text_parts.append(c["text"])

    final_text = "\n".join(text_parts).strip()
    if final_text:
        print(final_text)
    else:
        # Fallback: print raw JSON if we can't find text output.
        print(json.dumps(out, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
