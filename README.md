# Santino's — site institucional

Site estático de uma página para a marca Santino's, com os três produtos: Suave, Defumado e Extra Forte.

## Arquivos

- `index.html` — estrutura da página
- `style.css` — estilo (paleta, tipografia, layout)
- `script.js` — menu mobile e ano do rodapé
- `CNAME` — aponta o GitHub Pages para o domínio `santinos.com.br`

Não há build nem dependências — é só HTML/CSS/JS puro.

## Como publicar no GitHub Pages (repositório `santinos`)

1. **Suba os arquivos para o repositório**, na branch `main`, na raiz (não dentro de uma subpasta):
   ```bash
   cd santinos-site
   git init
   git remote add origin https://github.com/SEU_USUARIO/santinos.git
   git add .
   git commit -m "Site Santino's"
   git branch -M main
   git push -u origin main
   ```

2. No GitHub, entre no repositório **santinos** → aba **Settings** → menu **Pages**.

3. Em **Build and deployment**, selecione:
   - Source: **Deploy from a branch**
   - Branch: **main** / pasta **/(root)**
   - Clique em **Save**.

4. Em **Custom domain**, digite `santinos.com.br` e salve. Isso confirma o conteúdo do arquivo `CNAME` que já está no repositório.

## Como apontar o domínio santinos.com.br para o GitHub Pages

No painel do registro.br (ou onde o domínio está registrado), configure o DNS:

**Opção A — domínio raiz (santinos.com.br) apontando direto:**
Crie 4 registros `A` para `@` apontando para os IPs do GitHub Pages:
```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

**Opção B — com `www` também funcionando:**
Além dos registros `A` acima, crie um registro `CNAME` para `www` apontando para:
```
SEU_USUARIO.github.io
```

A propagação de DNS pode levar de alguns minutos até 24h. Depois que propagar, marque a opção **Enforce HTTPS** em Settings → Pages para o site abrir com `https://`.

## O que já está configurado

- **Contato**: e-mail (contato@santinos.com.br), Instagram (@santinospeppersauces) e WhatsApp ((15) 99856-9761) já estão na seção `#contato`.
- **Fotos dos produtos**: as três fotos reais dos frascos estão em `assets/` (`suave.jpg`, `defumado.jpg`, `extra-forte.jpg`), já recortadas e com leve tratamento de cor para combinar com o fundo escuro do site.

## O que revisar antes de publicar

- Valores de SHU (ardência) na seção "Escala de ardência" são aproximados — ajuste se tiver os números exatos das suas pimentas.
- Se trocar as fotos dos produtos no futuro, mantenha o mesmo nome de arquivo em `assets/` (ou atualize o `src` no `index.html`, seção `#produtos`).

## Rodar localmente

Basta abrir `index.html` no navegador, ou rodar um servidor simples:
```bash
python3 -m http.server 8000
```
e acessar `http://localhost:8000`.
