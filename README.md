# FVF Hórus , App do motorista (mobile)

App Expo/React Native (Android + iOS) para o motorista bater ponto
durante a viagem, **funcionando sem internet** , todo evento é gravado
localmente (SQLite) no instante do toque e sincronizado com o backend em
segundo plano quando a conexão volta.

## ⚠️ Sobre "compatível com os últimos 10 anos de sistema operacional"

Isso não é totalmente possível com as ferramentas atuais, e é importante
ser direto sobre isso:

- **Android**: `minSdkVersion 23` (Android 6.0, 2015) , dá pra cobrir
  ~10 anos, e é o piso que o próprio React Native/Expo aceita hoje.
- **iOS**: o Expo SDK atual (e o próprio Xcode/App Store) exige no
  mínimo iOS 13.4 (2019) para compilar , a Apple não permite mais
  submeter apps com deployment target mais antigo que isso, então
  suportar iPhones com iOS de 10 anos atrás (iOS 9, 2015) está fora do
  alcance de qualquer app novo hoje, não só deste. Na prática, "últimos
  ~6-7 anos" é o piso real pra iOS.

Se isso for um requisito duro de algum edital/cliente, vale documentar
esse limite explicitamente na proposta comercial, porque nenhum
framework atual (nem app nativo puro) contorna a política da Apple.

## Setup (rodar no seu computador, uma vez)

```bash
cd fvf-horus/mobile
npm install
npx expo install --fix   # alinha expo/react-native/expo-* com o SDK atual do seu Expo Go
npx expo start
```

Abra o app **Expo Go** no celular e escaneie o QR code que aparece no
terminal. Se o Expo Go instalado for de um SDK diferente do que o
`expo install --fix` resolveu, o próprio Expo avisa e diz o que fazer
(geralmente atualizar o Expo Go pela loja).

Antes de testar em campo, copie `.env.example` para `.env` e ajuste
`EXPO_PUBLIC_API_URL` para apontar para o backend (na Hostinger em
produção; `http://SEU-IP:3000` ou um `ngrok`/túnel se for testar contra
o backend rodando local com o celular numa rede diferente do
computador). O Expo lê automaticamente qualquer variável prefixada com
`EXPO_PUBLIC_` do `.env` e embute o valor no bundle , não precisa
reiniciar nada além do `npx expo start`. Para builds via EAS
(`eas.json`), cada perfil (`development`/`preview`/`production`) já
define seu próprio `EXPO_PUBLIC_API_URL`, então não é preciso editar
código pra apontar builds diferentes para ambientes diferentes.

## Fluxo de vínculo do aparelho

1. App gera um `deviceUuid` (uma vez, guardado no Keychain/Keystore) e
   mostra na tela de onboarding.
2. Motorista passa esse código pro RH/gestor da empresa.
3. Gestor vincula pelo painel web (`POST /motoristas/:id/dispositivo`) e
   recebe a `deviceApiKey` (mostrada uma única vez).
4. Motorista cola o `motoristaId` + a `deviceApiKey` no app , a partir
   daí todo `POST /registros-jornada` sai com os três headers
   (`X-Motorista-Id`/`X-Device-Uuid`/`X-Device-Key`).

Não existe (de propósito) nenhum fluxo de autovínculo , só a empresa
autoriza um aparelho, igual está desenhado no backend.

### Troca de aparelho (celular perdido/quebrado) e revogação

- Se o motorista não tem mais como se autenticar (celular perdido,
  quebrado, trocado), a tela de onboarding tem um link "Solicitar troca
  de aparelho" que manda uma `SolicitacaoTrocaDispositivo` pro backend
  **sem precisar de credenciais válidas** (o endpoint é público, mas
  não dá nenhum acesso por si só , só entra numa fila). Só um
  ADMIN/GESTOR aprovando pelo painel web é que efetivamente revincula o
  novo aparelho.
- Depois de enviar a solicitação, o app guarda um marcador local
  (`secureCredentials.ts`) pra mostrar "aguardando aprovação" se o app
  for reaberto antes da resposta, em vez de reexibir o formulário em
  branco. Tem um link "Enviar de novo / corrigir dados" pra reabrir o
  formulário se precisar corrigir algo.
- Se a empresa aprovar a troca para **outro** aparelho (ou revogar o
  vínculo), este aparelho fica com credenciais inválidas. O app detecta
  isso automaticamente: se uma rodada de sincronização toma 401 em
  **todos** os itens pendentes da fila (não só um, pra evitar falso
  positivo de erro passageiro), ele limpa o vínculo local, avisa o
  motorista com um alerta explicando o motivo e volta pra tela de
  onboarding , de onde ele pode solicitar uma nova troca se for engano.

## O que já funciona

- Onboarding (gerar/mostrar `deviceUuid`, salvar vínculo).
- Registrar ponto para todos os `TipoEvento` do backend, com GPS
  best-effort e odômetro/observação opcionais , grava local
  instantaneamente, mesmo sem internet.
- Fila local SQLite com status (`PENDENTE`/`ENVIADO`/`ERRO`) e
  `idempotencyKey` por registro (retry seguro, sem duplicar na cadeia).
- Sincronização automática ao reconectar (`NetInfo`) + pull periódico
  (60s) + botão manual "Sincronizar agora" na tela de Histórico.
- **Sincronização em background** (`src/sync/backgroundTask.ts`,
  `expo-task-manager`+`expo-background-fetch`): tenta esvaziar a fila
  mesmo com o app minimizado/fechado. É um complemento , o SO decide
  quando rodar de fato (nunca garantido no Android/iOS, normalmente a
  cada 15min-1h), então a sincronização em foreground continua sendo a
  principal.
- **Notificações push** (`src/notifications/pushRegistration.ts`,
  `expo-notifications`): o app pede permissão, registra o Expo push
  token no backend (`PATCH /dispositivo/meu-push-token`) e o motor de
  limites legais de jornada (backend) dispara um push automático pra
  cada alerta **CRÍTICO** (direção contínua ≥5h30, jornada ≥10h, espera
  ≥5h). Usa a Expo Push API (gratuita, sem precisar de certificado
  Apple/Firebase próprio pra rodar no Expo Go ou em build gerenciado).
- **Meus alertas** e **comprovante em PDF**: tela de Histórico mostra os
  últimos alertas do próprio motorista e tem um botão "Baixar /
  compartilhar comprovante" que baixa o PDF do backend
  (`GET /registros-jornada/meu-comprovante`) e abre a folha de
  compartilhamento nativa (salvar, WhatsApp, e-mail, imprimir).
- Histórico local completo, incluindo o que ainda não sincronizou.
- **Solicitação de troca de aparelho** (celular perdido/quebrado, sem
  precisar de credenciais válidas) com persistência local do estado
  "aguardando aprovação" entre reaberturas do app.
- **Detecção automática de revogação/troca aprovada**: se o vínculo
  deste aparelho for encerrado pela empresa, o app percebe (401
  uniforme em toda a fila pendente), limpa as credenciais locais e
  volta pro onboarding com um aviso explicando o motivo.
- **Filtro de período no comprovante em PDF**: a tela de Histórico tem
  um link opcional "filtrar por período" com dois campos de data
  (`AAAA-MM-DD`) que são validados antes de baixar o PDF só daquele
  intervalo (usa o `?inicio=&fim=` que o endpoint já aceitava).
- **Bloqueio de "mock location"** e **alerta de root/jailbreak/hooking**
  (`src/security/deviceIntegrity.ts`, lib `jail-monkey`): se a opção
  "permitir localização falsa" estiver habilitada no Android, o app
  bloqueia o registro de ponto até você desativar. Root/jailbreak não
  bloqueia (falso positivo demais em celular legítimo rooteado), só vai
  como flag auditada pro gestor ver no painel.
- **Criptografia local (AES-256-GCM)** do payload sensível da fila
  offline (GPS, odômetro, observação) , ver `src/storage/localEncryption.ts`.
  A chave fica só no Keychain/Keystore; um dump do arquivo `.db` sozinho
  não expõe nada. É o equivalente funcional a "SQLCipher no SQLite
  local" sem precisar trocar o motor do banco/ejetar pra build nativa.
- **SSL/certificate pinning** configurável por ambiente
  (`src/security/sslPinning.ts`, `EXPO_PUBLIC_SSL_PIN_HOST`/
  `EXPO_PUBLIC_SSL_PINS`) , desativado por padrão em dev (HTTP local),
  ativa nos perfis `preview`/`production` do EAS depois que o domínio
  de produção tiver HTTPS de verdade.

## O que falta (próximos passos)

- **Rodar uma build nativa própria (dev client) ao menos uma vez** ,
  a partir desta rodada, `jail-monkey` e o SSL pinning são módulos
  nativos: eles simplesmente NÃO EXISTEM dentro do Expo Go genérico da
  loja (fail-open silencioso , o app não trava, só não detecta nada).
  Pra testar essas duas features de verdade: `eas build --profile
development` (ou `npx expo prebuild` local, se tiver Android
  Studio/Xcode) e instalar o `.apk`/`.ipa` gerado no celular, depois
  `npm run start:devclient`. O resto do app (offline-first, push,
  troca de aparelho, comprovante) continua funcionando normalmente no
  Expo Go, sem precisar disso.
- **SSL pinning não testado contra um servidor real** , o domínio de
  produção da Hostinger ainda não existe; o comando pra gerar os pins
  está no topo de `src/security/sslPinning.ts`.
- **Assinatura/registro assinado no próprio dispositivo antes de
  enviar** (hoje a assinatura RSA é feita no backend; discutir se algum
  requisito de compliance exige assinatura na origem).
- **mTLS entre app e API** , decisão consciente de não fazer por
  enquanto (ver `ARCHITECTURE.md` §15): custo de infra alto (certificado
  por aparelho + TLS mútuo na borda + módulo nativo de rede) pro ganho
  marginal sobre device binding + SSL pinning que já existem.
- **Ícone/splash/branding** , ainda usando os placeholders padrão do
  Expo; falta receber os assets de marca (logo, cores, splash) pra
  gerar os ícones definitivos.
- **Build de produção real via EAS** (`eas.json` já configurado com os
  três perfis, mas ninguém rodou `eas build` de fato ainda , precisa da
  conta Expo/Apple Developer/Google Play do cliente, isso não é algo
  que dá pra fazer por aqui). Notificações push funcionam de graça no
  Expo Go/build de desenvolvimento; pra publicar de verdade na App
  Store é preciso configurar APNs via EAS (o Android/Expo Push já
  funciona sem passo extra).
- **Testes automatizados** (nenhum ainda, igual o backend).
- **Validação real em dispositivo físico** (tudo verificado até aqui
  foi checagem de sintaxe/tipos; falta rodar `npm install` +
  `npx expo start` de fato, algo que só o computador do cliente
  consegue fazer).

## Estrutura

```
App.tsx                        # switcher de telas (sem lib de navegação)
eas.json                       # perfis de build (development/preview/production)
.env.example                   # EXPO_PUBLIC_API_URL (copiar pra .env)
src/types.ts                   # espelha os enums/DTOs do backend
src/storage/secureCredentials.ts  # Keychain/Keystore (deviceUuid, motoristaId, deviceApiKey, solicitação pendente)
src/storage/db.ts              # fila SQLite offline-first
src/api/client.ts               # POST /registros-jornada com os 3 headers (API_URL via EXPO_PUBLIC_API_URL)
src/api/dispositivos.ts        # solicitação de troca de aparelho
src/api/alertas.ts             # GET dos alertas de jornada do motorista
src/api/comprovante.ts         # download + compartilhamento do PDF (com filtro de período)
src/security/deviceIntegrity.ts  # bloqueio de mock location + alerta de root/jailbreak/hooking (jail-monkey)
src/security/sslPinning.ts     # certificate/public-key pinning (react-native-ssl-public-key-pinning)
src/storage/localEncryption.ts # AES-256-GCM do payload sensível da fila local ("SQLCipher equivalente")
src/sync/syncService.ts        # esvazia a fila quando há rede + detecta revogação (401 uniforme)
src/sync/backgroundTask.ts     # sincronização em background (expo-task-manager)
src/notifications/pushRegistration.ts  # registro do Expo push token
src/screens/OnboardingScreen.tsx  # vínculo + solicitação de troca de aparelho
src/screens/RegistrarPontoScreen.tsx
src/screens/HistoricoScreen.tsx  # histórico + alertas + comprovante (com filtro de período)
```
