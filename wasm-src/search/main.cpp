#include "../shared/anime_engine.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define ANIME_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define ANIME_EXPORT
#endif

#include <cstddef>
#include <cstdint>

namespace {
anime::SearchEngine engine;
}

extern "C" {

ANIME_EXPORT int anime_search_reset() {
  return engine.reset();
}

ANIME_EXPORT int anime_search_add_csv(const std::uint8_t* data, std::size_t size) {
  return engine.add_csv(data, size);
}

ANIME_EXPORT int anime_search_finalize() {
  return engine.finalize();
}

ANIME_EXPORT int anime_search_clear_terms() {
  return engine.clear_terms();
}

ANIME_EXPORT int anime_search_set_combine_mode(int mode) {
  return engine.set_combine_mode(mode);
}

ANIME_EXPORT int anime_search_add_text_term(const char* value,
                                            const char* group,
                                            int match_mode,
                                            int negated) {
  return engine.add_text_term(value, group, match_mode, negated);
}

ANIME_EXPORT int anime_search_add_number_range(const char* column,
                                               const char* minimum,
                                               const char* maximum,
                                               int negated) {
  return engine.add_number_range(column, minimum, maximum, negated);
}

ANIME_EXPORT int anime_search_add_date_range(const char* column,
                                             const char* minimum,
                                             const char* maximum,
                                             int negated) {
  return engine.add_date_range(column, minimum, maximum, negated);
}

ANIME_EXPORT int anime_search_execute() {
  return engine.execute();
}

ANIME_EXPORT int anime_search_sort(int key, int direction) {
  return engine.sort(key, direction);
}

ANIME_EXPORT std::size_t anime_search_count() {
  return engine.count();
}

ANIME_EXPORT const char* anime_search_chunk_json(std::size_t offset, std::size_t limit) {
  return engine.chunk_json(offset, limit);
}

ANIME_EXPORT const char* anime_search_record_json_by_id(const char* id) {
  return engine.record_json_by_id(id);
}

ANIME_EXPORT const char* anime_search_last_error() {
  return engine.last_error();
}

}
