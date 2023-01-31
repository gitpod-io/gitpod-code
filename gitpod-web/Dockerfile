# FROM alpine:3.16
FROM scratch

COPY --chown=33333:33333 out /ide/extensions/gitpod-web/out/
COPY --chown=33333:33333 public /ide/extensions/gitpod-web/public/
COPY --chown=33333:33333 resources /ide/extensions/gitpod-web/resources/
COPY --chown=33333:33333 package.json package.nls.json README.md LICENSE.txt /ide/extensions/gitpod-web/
