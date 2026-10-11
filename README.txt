AI COVER STUDIO — PROTOTYP 0.1
================================

CO DZIAŁA:
- Import plików MP3/WAV/etc. i lokalny odsłuch oryginału.
- Import ZIP z RVC .pth lub .onnx; wykrywanie .index.
- Odczyt metadata.json, w tym RVC v2 i sample rate, o ile ZIP pozwala rozpakować ten plik.
- Zapisywanie pełnych ZIP-ów w lokalnej bibliotece IndexedDB.
- Usuwanie, wybieranie modeli, zapamiętanie biblioteki po odświeżeniu.
- Suwak pitchu zapamiętuje ustawienie w widoku (nie modyfikuje odsłuchu).

CZEGO JESZCZE NIE MA:
- Konwersji RVC (Convert celowo jest nieaktywny).
- Eksportu przekonwertowanego wokalu.
- Obsługi .index przez silnik AI.

JAK URUCHOMIĆ:
1. Rozpakuj cały folder AI Cover Studio.
2. Otwórz index.html w Chrome lub Edge.
3. Dodaj ZIP z modelem; import i zapis powinny działać w aktualnym Chrome/Edge.
4. Jeżeli file:// ograniczy przechowywanie danych, będziemy używać localhost.

PRYWATNOŚĆ:
Pliki są lokalne. Ta wersja nie pobiera żadnych bibliotek z CDN, nie wysyła modeli
na serwer i nie wykonuje żadnych żądań sieciowych.
Dane IndexedDB są przypisane do konkretnego pochodzenia/adresu strony i profilu przeglądarki.
Tryb incognito, czyszczenie danych witryny lub zmiana adresu mogą spowodować utratę biblioteki.
Zachowaj oryginalne ZIP-y na dysku. Nie umieszczaj modeli w publicznym repozytorium.

OSTRZEŻENIA:
Importer ZIP nie obsługuje ZIP64 ani szyfrowanych ZIP-ów. Obsługa kompresji
metadata.json wymaga DecompressionStream('deflate-raw') w przeglądarce.
Nie wrzucaj nieznanych archiwów do narzędzi uruchamiających kod. Tutaj ZIP jest tylko odczytywany.

PLAN NASTĘPNEGO ETAPU:
Zweryfikować silnik RVC Web Runtime + kompatybilność modelu v2 .pth,
a potem podłączyć prawdziwą konwersję oraz WAV export.
