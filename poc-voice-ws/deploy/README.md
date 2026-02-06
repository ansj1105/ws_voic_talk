# HTTPS (Nginx + Let's Encrypt)

## Prereq

- 도메인 A 레코드를 EC2 퍼블릭 IP로 설정
- 보안 그룹 인바운드: 80, 443 열기
- EC2에 Docker 설치

## Setup

```bash
cd poc-voice-ws
cp deploy/.env.example deploy/.env
```

`deploy/.env`에서 `DOMAIN`, `EMAIL`을 입력하세요.

```bash
./scripts/deploy-init.sh
```

성공하면 `https://<DOMAIN>`으로 접속 가능합니다.

## Renew

인증서는 자동 갱신 컨테이너(`certbot`)가 12시간마다 갱신 시도합니다.
수동 갱신은:

```bash
./scripts/deploy-renew.sh
```
