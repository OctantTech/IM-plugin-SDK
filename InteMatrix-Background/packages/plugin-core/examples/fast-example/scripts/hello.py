#!/usr/bin/env python3
"""Fast 插件示例脚本：读取 --name，输出 JSON。"""
import argparse
import json

parser = argparse.ArgumentParser()
parser.add_argument('--name', default='world')
args = parser.parse_args()
print(json.dumps({'message': f'hello {args.name}'}, ensure_ascii=False))
