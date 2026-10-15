# Auditoria de computadores

App Android para auditoria de computadores pelo **tombamento**. Os dados vão para uma planilha do **Google Sheets**.

- Lê o código de barras do tombamento pela câmera, ou você digita o número.
- Organiza por **setor**, com vários **subsetores** dentro de cada um.
- Em cada computador você anota a localização exata, a marca, o modelo (botões rápidos **Mini** e **Desktop**) e uma observação, se houver.
- Funciona com **vários usuários**: cada registro guarda quem fez, e todos veem o que os outros registraram.
- Avisa quando um tombamento já foi registrado.
- Funciona **sem internet**: os dados ficam no celular e são enviados quando a conexão volta. O número amarelo no botão ↻ mostra quantas alterações ainda não foram enviadas.

---

## 1. Configurar a planilha (uma vez só, feito por uma pessoa)

1. Acesse [sheets.google.com](https://sheets.google.com) e crie uma **planilha em branco**. Dê um nome a ela, por exemplo "Auditoria".
2. No menu, vá em **Extensões → Apps Script**.
3. Apague todo o código que aparece e cole o conteúdo do arquivo [`apps-script/Code.gs`](apps-script/Code.gs).
4. Na linha `const CHAVE = 'TROQUE-ESTA-CHAVE';`, troque `TROQUE-ESTA-CHAVE` por uma senha sua, por exemplo `auditoria2026`. Depois clique em 💾 **Salvar**.
5. Clique em **Implantar → Nova implantação**:
   - Na engrenagem ⚙️, escolha **App da Web**.
   - **Executar como:** Eu.
   - **Quem pode acessar:** Qualquer pessoa.
   - Clique em **Implantar** e autorize o acesso à sua conta. Se aparecer "o Google não verificou este app", clique em **Avançado → Acessar**.
6. Copie a **URL do app da Web** (termina em `/exec`). Ela e a chave vão ser usadas no celular.

As abas **Computadores** e **Setores** são criadas sozinhas na primeira sincronização.

> Se você alterar o script depois, use **Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão** para manter a mesma URL.

## 2. Instalar o app no celular

1. No celular Android, abra o navegador em
   **https://github.com/cleitonkeliton/auditoria/releases/latest**
2. Toque em **Auditoria.apk** para baixar e abra o arquivo.
3. Se o Android avisar sobre **fontes desconhecidas**, toque em **Configurações** e ative **Permitir desta fonte**. Volte e toque em **Instalar**.
4. Abra o app e preencha:
   - **Seu nome**
   - **Endereço da planilha:** a URL do passo 1.6
   - **Chave de acesso:** a senha do passo 1.4

Toda a equipe usa a mesma URL e a mesma chave, cada pessoa com o próprio nome.

Para **atualizar** o app, baixe o novo `Auditoria.apk` pelo mesmo link e instale por cima. Os dados salvos no celular continuam lá.

## 3. Como usar

1. **+ Novo setor** (ex.: "Financeiro") → abra o setor.
2. **+ Novo subsetor** (ex.: "Sala 101") → abra o subsetor.
3. **+ Computador** → toque em **📷 Ler** e aponte para o código de barras, ou digite o número. Preencha a localização, a marca, o modelo e a observação.
4. **Salvar e adicionar outro** mantém marca e modelo preenchidos, para agilizar o próximo cadastro.
5. Na tela inicial, a busca encontra qualquer computador por tombamento, marca, modelo ou local.
6. Toque em um computador para editar ou excluir.

---

## Para desenvolvedores

- `www/`: o app (HTML, CSS e JavaScript), empacotado como APK com [Capacitor](https://capacitorjs.com).
- `apps-script/Code.gs`: recebe os dados e grava na planilha.
- `android/`: o projeto Android gerado pelo Capacitor.
- `.github/workflows/apk.yml`: a cada push, gera o APK e publica em *Releases*.

Para testar no computador, sem celular nem Google:

```bash
npm install
npm run copy-libs
node test/servidor-teste.mjs   # abre em http://localhost:8765 (simula a planilha)
```

No app, use a URL `http://localhost:8765/exec` e a chave `teste123`.

O APK é assinado com `android/app/auditoria.keystore`, que está no repositório. Assim cada versão instala por cima da anterior.
