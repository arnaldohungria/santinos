# 2026-11-25 — App Android do painel

## O quê
- APK `Santinos-Painel.apk` (1.0, Android 10+) publicado no Release `app-v1.0` deste repositório.
- Link **"Baixar app Android ↓"** no rodapé do menu do painel (`admin.html`), apontando para
  `releases/latest/download/Santinos-Painel.apk` (sempre a versão mais recente).

## Por quê
O Arnaldo quer gerenciar os pedidos pelo celular. O app abre o próprio `admin.html`; mudança no painel aparece nele sem novo APK.
Sem aviso com o app fechado (escolha dele). Não há senha nem segredo dentro do APK.

## Cuidados
- O código e a chave de assinatura ficam só no PC (`SANTINOS/app-android`). **A pasta `assinatura` nunca vai para o repositório.**
- Versão nova: subir o `versionCode`, rodar `compilar.sh`, criar o Release `app-vX.Y` com o APK **no mesmo nome**.
  Todo Release "latest" do repositório precisa conter esse arquivo, senão o link quebra.
- O app depende de: endereço do `admin.html`, ids `app`/`login`/`drawer` e a chave `santinos_admin_auth`.

## Como testar
Painel → menu → Baixar app Android.

## Como reverter
`git revert` do PR; apagar o Release, se quiser tirar o download do ar.

## Pendências
Confirmar no celular: digital, salvar em Downloads, impressão e WhatsApp.
