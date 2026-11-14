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
- **Integrationsstand:** Der unten dokumentierte Regie-Umsetzungsschritt ist implementiert. Noch offene Vertrags- und Geräteintegrationen sind ausdrücklich benannt. Keine Geräte- oder DMG-Freigabe ohne separate Abnahme.

## Umsetzungskommentare · 14.11.2026

Diese Kommentare dokumentieren den aktuellen Umsetzungsschritt; sie sind **keine designerische Freigabe**. Das verlinkte Online-Übergabe-Doc war über den verfügbaren Zugriff nicht lesbar. Die Entscheidungen stehen deshalb hier im Repository, nicht als behauptete Online-Kommentare.

### Kommentar 01 · Regie und eindeutige Bedienwege
`v107-shell.tsx`, `v107-stage.tsx`, `v107.css`: neue Kopfleiste mit unabhängig belegten DE-/RU- und OBS-Zuständen, Programmbild, Kameraansichten, Einblend-Karten und genau einem Szenen-/Ton-Dock. Die alte Sidebar, zusätzlichen Hauptbild-Tasten und die zweite manuelle Szenensteuerung sind aus der Regie entfernt. Bild-Chips sind nicht anklickbar. Vollbild benutzt dieselben DOM-Bedienelemente, keine kopierten Aktionen. Acht vorhandene Szenen belegen F1–F8; die README-Angabe F1–F9 ist für acht Kacheln widersprüchlich. Eingabefelder und Dialoge sperren die Kürzel.

### Kommentar 02 · Rückmeldungen und Störung
Ein Klick bestätigt kein Bild. Gold folgt `pendingAction`; Auswahl und Rot folgen frischer OBS-Beobachtung. Rot setzt bestätigte Übertragung ohne Wiederverbindung voraus. YouTube besitzt eigene Aktualitätsprüfung und wird nicht aus OBS abgeleitet. Veraltete oder fehlende Zustände sind offen, nie implizit aus. Fehler sind eine goldene Hinweisspur, keine roten Gefahrentasten. Bei OBS-Ausfall bleibt der geprüfte Abschluss erreichbar; die App behauptet nicht, einen unerreichbaren Encoder stoppen zu können. Abgabe, Rückkehr-Abbruch und Abschluss-Abbruch umgehen die normale UI-Aktionssperre.

### Kommentar 03 · Überblenden und bestehende OBS-Einstellungen
`live-transition.ts`: Standard 900 ms, wählbar 300 / 600 / 900 / 1500 / 2500 ms. Auswahl nach OBS-Typ `fade_transition`, nicht nach übersetztem Namen. Globale oder szenenspezifische Überblendung wird geprüft. Bei abweichender Konfiguration wird **eine persistente Übergangsüberschreibung für die zugeordnete Zielszene** gesetzt und zurückgelesen. Keine globale Änderung, kein Fallback auf Schnitt oder Schwarz. Fehlende/unbestätigte Überblendung verhindert den Szenenwechsel. Diese Wirkung ist im Freigabedialog genannt. Die Dauer gehört zum Freigabeschlüssel; Änderung verlangt eine neue Freigabe.

### Kommentar 04 · Szenen und Ende
Main schaltet ausdrücklich den Ton ein. Intro schaltet ihn aus, ohne einen laufenden Stream neu zu starten. Beten bleibt jetzt wie die anderen Szenen ausgewählt; der bisherige 15-s-Gebetsbefehl bleibt für ältere Aufrufer erhalten. Kapitel, Zwischenbild, Singen und Stream steuern vorhandene, explizit zugeordnete OBS-Szenen. Fehlende Zuordnungen sperren nur die betroffene Kachel.

**Abweichung zur früheren Alpha-Anforderung:** Die Outro-Kachel zeigt nur Outro, „Beenden“ startet nach Zielprüfung den bestehenden 15-s-Abschluss. Das folgt der Trennung von `scene.set` und `service.stop` im neuen Vertrag. Ein sofortiger Abbruch und die Rückkehr über Main bleiben möglich. Kein zweiter Outro-Knopf im Abschlussdialog. Die native Sicherheitsbestätigung vor Outro bleibt vorerst erhalten; bitte im Design-Review entscheiden.

### Kommentar 05 · Einblendungen und Bibelstellen
Kurzschreibweisen wie `1 Kor 4, 12ff` werden als `1. Korinther Kap. 4 ab Vers 12` vorgeschlagen. Buchnamen und Aliase stammen aus dem Export. Mehrdeutige/ungültige Eingaben werden nicht geraten; eine eigene Stellenangabe kann unverändert gespeichert werden. Das ist **keine Prüfung eines Übersetzungstexts oder aller Versgrenzen**. Einträge sind pro Sendung editierbar. Eine Änderung setzt nur den Gelesen-Marker dieses Eintrags zurück; sichtbarer OBS-Text bleibt bis zum bewussten Einblenden unverändert. Warteschlangenfortschritt erst nach OBS-Bestätigung.

**Noch offene Vertragsintegration:** Bestehende Sprecher-/Bibel-Szenen und ihre 15-s-Rückkehr werden bewusst wiederverwendet. Echte Overlays auf Main, automatische Kapiteltexte, Liedsuche und Strophen-/Refrain-Seiten sind in diesem Schritt noch nicht implementiert. Keine Demo-Texte werden als reale Quellen übernommen.

### Kommentar 06 · Vorschau, Russisch und Geräte
Die Vorschau benutzt echte, begrenzte OBS-Screenshot-Abfragen (Programm 900 ms, Kameras 2500 ms, keine überlappenden Anfragen; pausiert im Hintergrund). Alte oder zu einer anderen Szene gehörende Frames sind nicht als aktuell markiert. Das ist **kein Video-Transport mit garantierter geringer Latenz** und kein YouTube-Player.

RU-YouTube-Zustand und gezieltes RU-/DE-Ende bleiben real angebunden. **Der Web-Presenter-Gerätetreiber, Bildmischer-Tally, Kamera-Ruheposition und Ende-Automatik über alle Geräte fehlen weiterhin.** Unbestätigte Hardware wird entsprechend benannt. Festlegung 8 ist damit noch nicht vollständig erfüllt; keine simulierte Bestätigung ersetzt diese Integration.

### Kommentar 07 · Symbole, Schrift, Sprache
Gefüllte Symbolpfade aus dem gelieferten Prototyp werden als statische, nicht benutzergesteuerte SVGs verwendet; die Bediensymbole haben 1,8 px Kontur. Hell/Dunkel und reduzierte Bewegung werden unterstützt. Keine extern geladenen Schriften: Inter bei vorhandener Installation, ansonsten Systemschrift. Das lokale Bündeln der gewünschten Schriftfamilien bleibt offen. Kernbedienung und die betroffenen nativen Freigabe-/Outro-/Start-/Ende-Dialoge sind deutsch. Die älteren erweiterten Diagnose-/YouTube-Fenster sind noch nicht vollständig sprachlich überarbeitet.

## Prüfung dieses Umsetzungsschritts
- `npm run typecheck`, `npm run build`, `npm test` mit vorhandenen und neuen V107-Regressionen.
- Neue Tests: Referenzparser, Bearbeitung/Persistenz, bestätigte Zustandsfarben, getrennte YouTube-Belege, Übergangsüberschreibung, Rücklesefehler, Abbruch und neue Szenenbefehle.
- `scripts/smoke-v107.cjs`: echte Electron-Oberfläche, IPC und authentifizierter synthetischer OBS-WebSocket; kein Zugriff auf reale Konten oder Gemeindegeräte. Der Workflow legt Bericht und Screenshots unter `release/v107` ab.
- Vor Einsatz: Auf dem Ziel-Mac mit den echten OBS-Zuordnungen alle Übergänge prüfen; DE-/RU-Abschluss einschließlich Abbruch gegen Test-Events abnehmen. Die Prüfung mit synthetischem OBS ersetzt diese Geräteabnahme nicht.
