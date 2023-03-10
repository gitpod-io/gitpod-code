#!/bin/bash
# Copyright (c) 2023 Gitpod GmbH. All rights reserved.
# Licensed under the GNU Affero General Public License (AGPL).
# See License.AGPL.txt in the project root for license information.

set -Eeo pipefail

yarn run build:gitpod-web

docker build ./gitpod-web -t gitpod-web

rm -rf /workspace/rebuild && true
mkdir -p /workspace/rebuild
docker save gitpod-web -o /workspace/rebuild/gitpod-web.tar
tar -xvf /workspace/rebuild/gitpod-web.tar -C /workspace/rebuild/
find /workspace/rebuild/ -name layer.tar -exec tar -xvf {} -C /workspace/rebuild/ \;

rm -rf /ide/extensions/gitpod-web && true
ln -s /workspace/rebuild/ide/extensions/gitpod-web /ide/extensions/gitpod-web
echo "gitpod-web: linked in /ide/extensions"

gp rebuild --gitpod-env GP_OPEN_EDITOR= --gitpod-env GP_PREVIEW_BROWSER= --gitpod-env GP_EXTERNAL_BROWSER=
