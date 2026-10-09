import * as NavigationBar from "expo-navigation-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Faixa da barra de navegação do Android (edge-to-edge): azul vibrante e escuro no tema claro, quase preto no escuro. Botões sempre #FFFFFF. */
const COR_BARRA_NAVEGACAO_CLARO = "#0A3FBF";
const COR_BARRA_NAVEGACAO_ESCURO = "#05070D";
import * as SecureStore from "expo-secure-store";
import { Platform, View } from "react-native";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

/**
 * Tema claro/escuro do app do motorista. É só preferência visual , não
 * tem relação nenhuma com a criptografia/segurança do resto do app,
 * mas usa o mesmo SecureStore só para não introduzir mais uma
 * dependência nova (AsyncStorage) num projeto onde instalar pacote
 * novo já deu problema várias vezes neste ambiente (ver
 * claude/bloqueios-dependentes-do-usuario.md).
 */
export type Tema = "claro" | "escuro";

export interface CoresTema {
  fundo: string;
  fundoCartao: string;
  texto: string;
  textoSecundario: string;
  borda: string;
  primario: string;
  primarioTexto: string;
  inputFundo: string;
  inputBorda: string;
  inputPlaceholder: string;
  tabInativa: string;
  tabAtiva: string;
  perigo: string;
  statusBar: "light" | "dark";
}

const CORES_CLARO: CoresTema = {
  fundo: "#ffffff",
  fundoCartao: "#f9fafb",
  texto: "#111827",
  textoSecundario: "#6b7280",
  borda: "#e5e7eb",
  primario: "#111827",
  primarioTexto: "#ffffff",
  inputFundo: "#ffffff",
  inputBorda: "#e5e7eb",
  inputPlaceholder: "#9ca3af",
  tabInativa: "#9ca3af",
  tabAtiva: "#111827",
  perigo: "#dc2626",
  statusBar: "dark",
};

const CORES_ESCURO: CoresTema = {
  fundo: "#0b0f17",
  fundoCartao: "#161c27",
  texto: "#f3f4f6",
  textoSecundario: "#9ca3af",
  borda: "#2a3242",
  primario: "#e5e7eb",
  primarioTexto: "#111827",
  inputFundo: "#1f2633",
  inputBorda: "#2a3242",
  inputPlaceholder: "#6b7280",
  tabInativa: "#6b7280",
  tabAtiva: "#f3f4f6",
  perigo: "#f87171",
  statusBar: "light",
};

const CHAVE_TEMA = "fvfhorus.tema";

interface ContextoTema {
  tema: Tema;
  cores: CoresTema;
  alternarTema: () => void;
}

const ThemeContext = createContext<ContextoTema | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>("claro");

  useEffect(() => {
    SecureStore.getItemAsync(CHAVE_TEMA)
      .then((salvo) => {
        if (salvo === "claro" || salvo === "escuro") setTema(salvo);
      })
      .catch(() => {
        // Sem preferência salva ainda (ou SecureStore indisponível) , fica no claro (padrão).
      });
  }, []);

  // Botões da barra de navegação do Android (voltar/início/recentes): no
  // tema claro o fundo é branco e o sistema desenhava os botões em cinza
  // claro (quase invisíveis). "light" = barra clara com botões escuros;
  // "dark" = barra escura com botões claros. Exige o plugin
  // expo-navigation-bar com enforceContrast:false (app.json).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    try {
      // "light" no expo-navigation-bar = botões CLAROS (brancos). A barra é
      // sempre escura (faixa desenhada abaixo), então os botões são sempre brancos.
      NavigationBar.setStyle("light");
    } catch {
      // Sem suporte neste aparelho , fica com o estilo padrão do sistema.
    }
  }, [tema]);

  const insets = useSafeAreaInsets();

  function alternarTema() {
    setTema((atual) => {
      const novo: Tema = atual === "claro" ? "escuro" : "claro";
      void SecureStore.setItemAsync(CHAVE_TEMA, novo).catch(() => {
        // Só não persiste a preferência , o app continua funcionando no tema escolhido nesta sessão.
      });
      return novo;
    });
  }

  const cores = tema === "claro" ? CORES_CLARO : CORES_ESCURO;

  return (
    <ThemeContext.Provider value={{ tema, cores, alternarTema }}>
      <View style={{ flex: 1 }}>
        {children}
        {Platform.OS === "android" && insets.bottom > 0 && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: insets.bottom,
              backgroundColor:
                tema === "claro" ? COR_BARRA_NAVEGACAO_CLARO : COR_BARRA_NAVEGACAO_ESCURO,
            }}
          />
        )}
      </View>
    </ThemeContext.Provider>
  );
}

export function useTema(): ContextoTema {
  const ctx = useContext(ThemeContext);
  if (!ctx)
    throw new Error("useTema precisa ser chamado dentro de um ThemeProvider");
  return ctx;
}
