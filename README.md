# Auditoria de computadores

App Android para auditoria de computadores pelo **tombamento**. Os dados vão para uma planilha do **Google Sheets**.

- Lê o código de barras do tombamento pela câmera com o leitor do Google (ML Kit), ou você digita o número.
- Organiza por **setor**. Os computadores podem ficar direto no setor ou, se ele for dividido, em **subsetores**.
- Em cada computador você anota a localização exata, a marca, o modelo (botões rápidos **Mini** e **Desktop**) e uma observação, se houver.
- Funciona com **vários usuários**: cada registro guarda quem fez, e todos veem o que os outros registraram.
- Avisa quando um tombamento já foi registrado.
- Funciona **sem internet**: os dados ficam no celular e são enviados quando a conexão volta. O número amarelo no botão ↻ mostra quantas alterações ainda não foram enviadas. Se o envio falhar por outro motivo, aparece um aviso amarelo explicando o que fazer.

---

## 1. Configurar a planilha (uma vez só, feito por uma pessoa)

1. Acesse [sheets.google.com](https://sheets.google.com) e crie uma **planilha em branco**. Dê um nome a ela, por exemplo "Auditoria".
2. **Dentro da planilha**, vá em **Extensões → Apps Script**.
3. Apague todo o código que aparece e cole o conteúdo **inteiro** deste link (Ctrl+A, Ctrl+C):
   **https://raw.githubusercontent.com/cleitonkeliton/auditoria/main/apps-script/Code.gs**
4. Na linha `const CHAVE = 'TROQUE-ESTA-CHAVE';`, troque `TROQUE-ESTA-CHAVE` por uma senha sua, por exemplo `auditoria2026`. Mantenha as aspas. Depois clique em 💾 **Salvar**.
5. Na barra de cima do editor, ao lado de **Executar**, escolha a função **`configurar`** e clique em **Executar**.
   - O Google vai pedir autorização: **Revisar permissões** → escolha sua conta → **Avançado** → **Acessar (não seguro)** → **Permitir**. O aviso aparece porque o script é seu e não passou pela verificação do Google.
   - No **Registro de execução** deve aparecer "**Tudo pronto!**".
6. Clique em **Implantar → Nova implantação**:
   - Na engrenagem ⚙️, escolha **App da Web**.
   - **Executar como:** Eu.
   - **Quem pode acessar:** Qualquer pessoa.
   - Clique em **Implantar**.
7. Copie a **URL do app da Web** (termina em `/exec`). Ela e a chave vão ser usadas no celular.
8. **Confira:** abra essa URL no navegador. Deve aparecer "✅ Planilha da auditoria funcionando". Se aparecer ❌, a página explica o que falta.

> **Alterou o código depois?** Use **Implantar → Gerenciar implantações → ✏️ (editar) → Versão: Nova versão → Implantar**. Isso mantém a mesma URL. Se você só salvar, a URL continua rodando o código antigo.

### Se o app não conseguir enviar para a planilha

O app mostra um aviso amarelo com o motivo. Os dados ficam guardados no celular até o envio dar certo.

- **"Sem permissão para abrir a planilha" / "You do not have permission":** faça os passos 5 e 6 de novo, ou seja, execute `configurar` e depois a implantação com **Executar como: Eu**, **Quem pode acessar: Qualquer pessoa** e **Nova versão**. Faça tudo com a **mesma conta Google** que é dona da planilha. Se você usa mais de uma conta no navegador, use uma janela anônima só com essa conta.
- **"Chave de acesso inválida":** a chave digitada no app é diferente da `CHAVE` do script. Letras maiúsculas e minúsculas contam.
- **"A planilha respondeu com uma página":** a URL está errada (precisa terminar em `/exec`) ou a implantação não está como **Qualquer pessoa**.

## 2. Instalar o app no celular

1. No celular Android, abra o navegador em
   **https://github.com/cleitonkeliton/auditoria/releases/latest**
2. Toque em **Auditoria.apk** para baixar e abra o arquivo.
3. Se o Android avisar sobre **fontes desconhecidas**, toque em **Configurações** e ative **Permitir desta fonte**. Volte e toque em **Instalar**.
4. Abra o app e preencha:
   - **Seu nome**
   - **Endereço da planilha:** a URL do passo 1.7
   - **Chave de acesso:** a senha do passo 1.4

Toda a equipe usa a mesma URL e a mesma chave, cada pessoa com o próprio nome.

Para **atualizar** o app, baixe o novo `Auditoria.apk` pelo mesmo link e instale por cima. Os dados salvos no celular continuam lá.

## 3. Como usar

1. **+ Novo setor** (ex.: "Financeiro") → abra o setor.
2. Adicione os computadores:
   - **Setor sem divisões:** toque em **+ Computador**. Ele fica direto no setor.
   - **Setor dividido** (salas, por exemplo): toque em **+ Subsetor** (ex.: "Sala 101"), abra o subsetor e toque em **+ Computador**.
3. No cadastro, toque em **📷 Ler** e aponte para o código de barras. Ele pode estar na horizontal ou na vertical. Se preferir, digite o número. Depois preencha a localização, a marca, o modelo e a observação.
4. **Salvar e adicionar outro** mantém marca e modelo preenchidos, para agilizar o próximo cadastro.
5. Na tela inicial, a busca encontra qualquer computador por tombamento, marca, modelo ou local.
6. Toque em um computador para editar ou excluir.

**Sobre o número do tombamento:** ele é guardado só com os dígitos, sem ponto e sem zeros à esquerda. Assim, `756.322` vira `756322` e `0008120441` (o que o código de barras da etiqueta contém) vira `8120441`. O número lido pela câmera e o digitado ficam iguais, e o aviso de tombamento repetido funciona com qualquer um dos dois.

**Sobre o leitor:** na primeira vez, o Google baixa a tela de leitura dele (precisa de internet, só uma vez). Enquanto isso, ou sem internet, o app usa a própria câmera com o mesmo leitor, que tem botão de lanterna.

---

## Para desenvolvedores

- `www/`: o app (HTML, CSS e JavaScript), empacotado como APK com [Capacitor](https://capacitorjs.com).
- `apps-script/Code.gs`: recebe os dados e grava na planilha.
- `android/`: o projeto Android gerado pelo Capacitor.
- `.github/workflows/apk.yml`: a cada push, gera o APK e publica em *Releases*.

Para testar no computador, sem celular nem Google:

```bash
npm install
npm test                       # testes do script da planilha
node test/servidor-teste.mjs   # abre em http://localhost:8765 (simula a planilha)
```

No app, use a URL `http://localhost:8765/exec` e a chave `teste123`.

O APK é assinado com `android/app/auditoria.keystore`, que está no repositório. Assim cada versão instala por cima da anterior.
