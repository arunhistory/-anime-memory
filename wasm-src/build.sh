#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/assets/wasm"
SHARED="${ROOT_DIR}/wasm-src/shared/anime_engine.cpp"

mkdir -p "${OUT_DIR}"

COMMON_FLAGS=(
  -std=c++17
  -O3
  -flto
  -fno-exceptions
  -fno-rtti
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sENVIRONMENT=web,node
  -sALLOW_MEMORY_GROWTH=1
  -sFILESYSTEM=0
  -sASSERTIONS=0
  -sMALLOC=emmalloc
  -sEXIT_RUNTIME=0
  -sINVOKE_RUN=0
  -sEXPORTED_RUNTIME_METHODS='["UTF8ToString"]'
)

em++ "${SHARED}" "${ROOT_DIR}/wasm-src/all/main.cpp" \
  "${COMMON_FLAGS[@]}" \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_anime_all_reset","_anime_all_add_csv","_anime_all_finalize","_anime_all_sort","_anime_all_count","_anime_all_chunk_json","_anime_all_last_error"]' \
  -o "${OUT_DIR}/all.js"

em++ "${SHARED}" "${ROOT_DIR}/wasm-src/search/main.cpp" \
  "${COMMON_FLAGS[@]}" \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_anime_search_reset","_anime_search_add_csv","_anime_search_finalize","_anime_search_clear_terms","_anime_search_set_combine_mode","_anime_search_add_text_term","_anime_search_add_number_range","_anime_search_add_date_range","_anime_search_execute","_anime_search_sort","_anime_search_count","_anime_search_chunk_json","_anime_search_record_json_by_id","_anime_search_last_error"]' \
  -o "${OUT_DIR}/search.js"

printf 'Built:\n'
ls -lh "${OUT_DIR}/all.js" "${OUT_DIR}/all.wasm" "${OUT_DIR}/search.js" "${OUT_DIR}/search.wasm"
