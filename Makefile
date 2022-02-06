TSC = npx tsc
DIST_DIR = dist
PACKAGES_DIR = packages
PACKAGES = stompit2-node stompit2-web

all: $(PACKAGES)

.PHONY: $(PACKAGES)
$(PACKAGES):
	mkdir -p $(DIST_DIR)/$@
	$(TSC) --project $(PACKAGES_DIR)/$@ --outDir $(DIST_DIR)/$@
	cp $(PACKAGES_DIR)/$@/package.json $(DIST_DIR)/$@/package.json
	cp ./README.md $(DIST_DIR)/$@/README.md
	cp ./LICENSE $(DIST_DIR)/$@/LICENSE

.PHONY: clean
clean:
	rm -rf $(DIST_DIR)

.PHONY: docs
docs:
	npx typedoc \
	src/index.ts \
	src/transport/netSocketStream.ts \
	src/transport/tlsSocketStream.ts \
	src/transport/webSocketStream.ts \
	--out docs

.PHONY: publish
publish:
	npm publish dist/stompit2-node
	npm publish dist/stompit2-web
