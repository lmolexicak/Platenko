# Publikovanie na sociálne siete a správa integrácií

## 1. Hlavný cieľ
Umožniť autorovi publikovať diela na **Instagram, Facebook a Aukro** (a do budúcna ďalšie API platformy) jedným kliknutím priamo z Admin CMS – aj z mobilu, bez nutnosti mať zapnutý počítač.
- **Cloudflare Worker** vybaví všetky platformy s oficiálnym API.
- **Lokálny skript (Playwright)** ostane vyhradený výhradne pre **Sashe.sk**, keďže nemá verejné API.

---

## 2. Správa pripojení v Admin CMS („Integrácie“)
V administrácii pribudne jednoduchá sekcia na správu prepojení:
- **Bezpečné uloženie:** Prístupové údaje sa po vložení v Admin UI na serveri zašifrujú (pomocou jedného hlavného šifrovacieho kľúča uloženého bezpečne v Cloudflare Secrets) a uložia do databázy.
- **Žiadne vracanie hesiel:** Kľúče a tokeny sa z backendu už nikdy neposielajú späť do prehliadača. Autor vidí len prehľadný stav (napr. *Pripojené*, dátum platnosti tokenu alebo prípadnú chybu) a možnosť kľúče prepísať či odpojiť.
- **Test pripojenia:** Pri každej platforme bude tlačidlo *„Otestovať pripojenie“*, ktoré overí platnosť kľúčov a zobrazí názov pripojeného účtu alebo jasnú chybovú hlášku.
- **Pripravené na budúcnosť:** Štruktúra uložených prístupov má počítať s tým, že sa nad ňu neskôr bez prepisovania databázy doplní OAuth tlačidlo *„Pripojiť účet“* pre úplných laikov.

---

## 3. Publikovanie diela na 1 klik
V detaile obrazu v Admin CMS bude možnosť vybrať cieľové platformy a odoslať dielo:
- **Správna verzia fotky:** Systém automaticky použije štylizovanú verziu (s rozostreným pozadím a tieňom) pre Instagram/Facebook a čistý orez plátna pre Aukro.
- **Odolnosť voči chybám:** Každá platforma sa publikuje nezávisle. Ak jedna sieť zlyhá, ostatné sa normálne dokončia a používateľ dostane prehľadný výsledok pre každú z nich.
- **Evidencia stavu:** Po úspešnom zverejnení sa pri diele uloží stav publikovania a ID príspevku/ponuky, aby bolo v admine hneď jasné, kde už obraz je.

---

## 4. Automatické udržiavanie pripojenia (bez údržby)
Tokeny pre Meta (Instagram/Facebook) a Aukro majú obmedzenú platnosť. Aby sa prepojenie samovoľne nerozpadlo:
- Na pozadí bude bežať pravidelná automatická úloha (napr. raz týždenne), ktorá skontroluje platnosť uložených tokenov.
- Ak sa blíži expirácia, systém token na pozadí automaticky obnoví, znova zašifruje a uloží nový dátum platnosti.
- Ak sa obnova nepodarí, systém zmení stav integrácie na chybový a zobrazí autorovi jasné upozornenie v Admin CMS.

---

## 5. Odporúčaný postup realizácie
1. **Integrácie a testovanie:** Najprv sprevádzkovať šifrované ukladanie kľúčov, formulár v Admin CMS a tlačidlo na otestovanie pripojenia.
2. **Publikovanie:** Po úspešnom teste pripojenia napojiť samotné odosielanie príspevkov a ponúk na 1 klik.
3. **Automatická obnova:** Na záver doplniť pravidelnú obnovu tokenov na pozadí.