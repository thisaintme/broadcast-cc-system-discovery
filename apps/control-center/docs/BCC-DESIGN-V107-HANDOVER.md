# BCC Design V107 – Übergabe / Implementierungsentscheidungen

Quelle: `bcc-design-export.zip`, README vom 14.11.2026, Prototyp V107. Basis: `feat/konzept-b-secrets-series`.

## Verbindliche Festlegungen
1. Pro Aktion genau ein Bedienweg: Szenen ausschließlich über Szenenkacheln; Audio ausschließlich über Dock-Knopf. Bild-Chips sind Status.
2. Rot nur für „auf Sendung“. Angeforderte Aktionen Gold; Störungen über eigene Leiste.
3. Szenenwechsel mit OBS-Überblenden (Cross Dissolve), standardmäßig 900 ms, konfigurierbar, niemals Schwarzblende.
4. Pro Knopf ein kurzer Satz zur Wirkung; Nicht-Wirkungen in die Hilfe.
5. Alle Bedientexte deutsch, verständlich für gelegentliche Helfer.
6. Szenen-/Markensymbole gefüllt aus `icons/`; Bedienicons 1,8 px Outline.
7. Animation ausschließlich als Rückmeldung; Positions- und Einblend-Transformationen getrennt halten.
8. Störung und russischer Web-Presenter-Stream sind Regiezustände.

## Integrationshinweise
- UI-Prototyp ist eine Interaktionsspezifikation, keine produktive Implementierung. Simulierte VU-Pegel, Zuschauerzahlen, Zustandsprüfungen, Bibeltexte und Lieder dürfen nicht als reale Werte angezeigt werden.
- Regie-Dienst bestätigt Szenenwechsel erst nach OBS-Erfolg; während der Anforderung Gold, bei Fehler Störungszustand.
- `cue.show` außerhalb Main aktiviert Main zuerst; `song.start` aktiviert Singen zuerst.
- Main schaltet Ton ein, Intro/Outro aus; `service.stop` löst Ende-Automatik aus.
- Bestehende YouTube-Konten, Schlüsselverwaltung, OBS-Steuerung, Russisch und Stream-Management nicht durch Prototyp-Dummies ersetzen.

## Abweichungen und offene Entscheidungen
- **Noch keine genehmigte Abweichung.** Jede Implementierungsabweichung mit Grund, betroffenen Komponenten, Datum und Entscheidung hier ergänzen.
- **Integrationsstand:** Branch und Übergabe-/Vertragsgrundlage angelegt; vollständige Übernahme der React/Electron-Oberfläche und Live-Integration stehen noch aus. Keine Funktions- oder DMG-Freigabe ohne Tests.
