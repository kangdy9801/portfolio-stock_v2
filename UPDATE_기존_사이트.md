# FOLIO v5 기존 GitHub Pages 업그레이드

**먼저 기존 FOLIO 사이트의 `↓ JSON 백업` 버튼으로 모든 개인 기록을 다운로드**하세요. 동일 저장소명·배포 URL·브라우저 프로필을 유지해야 브라우저에 저장해 둔 보유 종목·배당 내역이 그대로 표시됩니다.

## 기존 FOLIO v3/v4 → v5

1. 제공된 `FOLIO_v5_기존사이트_업데이트.zip`을 다운로드해 압축을 풉니다.
2. `index.html`, `assets/`, `data/reports.json`, `data/reports.js`, `.github/workflows/update-and-deploy.yml`, `scripts/update_macro.py`를 기존 GitHub 저장소의 **같은 경로**에 덮어씁니다.
3. 기존에 `data/macro.json`과 `data/macro.js`가 이미 있다면 **기존 파일을 유지**해 과거 기준금리 기록을 보존하세요. 없는 저장소(v3 등)라면 전체 설치 ZIP의 `data/macro.json`, `data/macro.js`를 새로 추가합니다.
4. **기존 `data/market.json`, `data/market.js`, `data/catalog.json`, `data/catalog.js`, `data/custom_stocks.json`을 그대로 유지**합니다. 자동 시세 수집 스크립트도 가능하면 전체 배포와 같은 버전으로 업데이트하세요.
5. Commit 후 GitHub Actions의 `Update Stock Prices and Deploy`를 실행하고 사이트 새로고침(Ctrl+F5)합니다. 저장돼 있던 개인 기록과 배당·투자 프로젝트가 유지되는지 확인합니다.

새 무역·산업 보고서 초기 기록은 공개 `data/reports.*`에 기본 포함됩니다. 추후 브라우저에서 PDF를 올린 개인 검토 기록은 해당 기기의 localStorage에 저장됩니다. **기기 간 자동 동기화는 되지 않습니다.**

*주의: 수정본 `PDF`를 올릴 때는 자동 파싱 결과를 원문과 반드시 대조하세요. 자료 수치 정정, 품목 매칭, 정의 차이로 잘못된 결론이 생길 수 있습니다.*
