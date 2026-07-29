FROM nginx:1.27-alpine

ENV BLAME_DOWNLOAD_REDIRECT_BASE_URL=https://blame-prod-downloads-gra.s3.gra.io.cloud.ovh.net
ENV BLAME_DOWNLOAD_LANDING_URL=https://blame.so/download
ENV NGINX_ENVSUBST_FILTER=^(BLAME_DOWNLOAD_REDIRECT_BASE_URL|BLAME_DOWNLOAD_LANDING_URL)$

COPY nginx.conf /etc/nginx/templates/default.conf.template
