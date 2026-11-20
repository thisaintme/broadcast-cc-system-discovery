# V107 – Geräteprotokolle und Grenzen

Alle Geräteadressen werden lokal eingerichtet und auf private IPv4-Adressen begrenzt. Ein Verbindungscheck liest nur. Steuerfreigaben werden nicht gespeichert. Jede Änderung ist begrenzt, wird bestätigt und nach Verbindungsverlust nicht automatisch wiederholt. Protokollantworten und Zugangsdaten gelangen nicht ins Protokoll oder in die Oberfläche.

## Quellen (abgerufen 14.11.2026)
- Blackmagic Ethernet Protocol 1.x, Stream State `Action: Start/Stop`, ACK plus bestätigter Status, TCP 9977: https://documents.blackmagicdesign.com/DeveloperManuals/WebPresenterEthernetProtocol.pdf?_v=1770192010000 (S. 2–4, 8–9, 12–13).
- SMTAV BA30S/N V2.5: VISCA Recall `81 01 04 3F 02 pp FF`, ACK/Completion mit gleicher Socketnummer, Position-Inquiry: https://cdn.shopify.com/s/files/1/0456/2701/5326/files/BA30X-x_User_Manual.pdf?v=1625557692 (S. 15, 24–25).
- SMTAV TCP 5678 / UDP 1259: https://www.smtav.com/blogs/how-to-use-the-camera/how-to-use-tcp-udp-control-the-smtav-camera
- X32 OSC: Patrick-Gilles Maillot, ursprüngliche Protokolluntersuchung und Werkzeuge: https://sites.google.com/site/patrickmaillot/x32 — `/bus/01..16/mix/on` als OSC int 0/1. Keine anderen Bus-, Kanal- oder Routingänderungen.
- ATEM: Sofie-Automation `atem-connection` 3.10.3, MIT, https://github.com/Sofie-Automation/sofie-atem-connection. Nur Beobachtung von M/E 1; keine automatischen ATEM-Schnitte.
- Elgato ältere Key-Light-HTTP-Schnittstelle: eigenständige Protokolluntersuchung https://github.com/adamesch/elgato-key-light-api — `/elgato/lights`, nur an/aus, Helligkeit und Temperatur bleiben erhalten. Neuere mTLS-only-Modelle werden nicht durch unsichere Fallbacks unterstützt.

## Betriebsgrenzen
Protokolltests ersetzen keinen Gerätetest am installierten Modell/Firmwarestand. Kameraposition bedeutet bestätigte Beendigung eines Preset-Aufrufs plus gemessene Pan/Tilt-Position, nicht Bildinhaltsanalyse. Rückmeldung eines Preset-Namens kann nach manueller Kamerabewegung veralten und wird deshalb nicht als dauerhafte Position angezeigt. Bei abgebrochener Steuerung kann eine bereits gesendete Kamerafahrt weiterlaufen; es folgt kein automatischer Gegenbefehl.

Web Presenter wird nur gestartet/gestoppt, wenn sein aktuelles eingebautes YouTube-RTMP-Profil, Schlüssel, Server und Geräteidentität mit der geprüften Auswahl übereinstimmen. Die App verändert weder Netzwerk noch Streamingziel. Drittanbieter-/SRT-Ziele werden nicht stillschweigend übernommen. Die lokale Geräteschnittstelle selbst ist unverschlüsselt; nur in einem vertrauenswürdigen Produktionsnetz betreiben.

Gemeinsame Ende-Automatik erst nach bestätigtem Stopp von OBS und gegebenenfalls Web Presenter. Unbekannt ist nicht aus. Aufnahme/Kameras/Mischpult/Licht nur nach expliziter Bestätigung der konkret geplanten Schritte. Fehler brechen Folgeschritte ab; keine automatische Wiederholung oder Rückabwicklung.
