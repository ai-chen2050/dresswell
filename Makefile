SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help
PORT ?= 4000

.PHONY: help geo geo-check devlog community build serve deploy all

help: ## 显示本帮助
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	 | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

geo: ## site.config.json → llms.txt / llms-full.txt / sitemap.xml / robots.txt / 各页 head
	python3 tools/gen_geo.py

geo-check: ## GEO 一致性体检（JSON-LD、canonical、hreflang、死链、占位残留）
	python3 tools/geo_check.py

devlog: ## devlog/src/*.md → devlog/*.html + 索引页
	python3 tools/build_devlog.py

community: ## 同步个人微信名片并用 TG 官方 Bot API 自动创建专属 Topic 交流群，再重建全站
	python3 tools/setup_community.py
	$(MAKE) build

build: devlog geo ## 全量重建（顺序有讲究：先生成日记页，再生成 sitemap）
	@echo "✅ 站点已重建"

serve: ## 本地预览
	@echo "→ http://localhost:$(PORT)/"
	@python3 -m http.server $(PORT)

deploy: build geo-check ## 检查通过后推送（GitHub Pages 由 Actions 自动发布）
	@git add -A && git commit -m "site: rebuild $$(date +%Y-%m-%d)" || true
	@git push
	@echo "→ 部署后记得访问线上域名验一遍 canonical 与 llms.txt"

all: build geo-check ## build + 体检
