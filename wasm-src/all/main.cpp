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
anime::AllEngine engine;
}

extern "C" {

ANIME_EXPORT int anime_all_reset() {
  return engine.reset();
}

ANIME_EXPORT int anime_all_add_csv(const std::uint8_t* data, std::size_t size) {
  return engine.add_csv(data, size);
}

ANIME_EXPORT int anime_all_finalize() {
  return engine.finalize();
}

ANIME_EXPORT int anime_all_sort(int key, int direction) {
  return engine.sort(key, direction);
}

ANIME_EXPORT std::size_t anime_all_count() {
  return engine.count();
}

ANIME_EXPORT const char* anime_all_chunk_json(std::size_t offset, std::size_t limit) {
  return engine.chunk_json(offset, limit);
}

ANIME_EXPORT const char* anime_all_last_error() {
  return engine.last_error();
}

}
