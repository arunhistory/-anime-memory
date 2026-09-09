#include "../shared/anime_engine.hpp"
#include "../shared/schema.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define ANIME_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define ANIME_EXPORT
#endif

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace {

class AllRuntime {
 public:
  int reset() {
    order_.clear();
    scratch_.clear();
    local_error_.clear();
    schema_checked_ = false;
    return dataset_.reset() ? 1 : 0;
  }

  int add_csv(const std::uint8_t* data, std::size_t size) {
    if (!dataset_.add_csv(data, size)) return 0;
    if (!schema_checked_) {
      std::string schema_error;
      if (!anime::schema::validate_common_schema(dataset_, schema_error)) {
        dataset_.reset();
        local_error_ = std::move(schema_error);
        return 0;
      }
      schema_checked_ = true;
    }
    local_error_.clear();
    return 1;
  }

  int finalize() {
    if (!schema_checked_) {
      local_error_ = "No valid common-schema CSV has been loaded.";
      return 0;
    }
    if (!dataset_.finalize()) return 0;
    order_ = dataset_.all_indices();
    if (!dataset_.sort_indices(order_, anime::SortKey::Season, anime::SortDirection::Asc)) {
      local_error_ = "Default all-title sort failed.";
      return 0;
    }
    local_error_.clear();
    return 1;
  }

  int sort(int key, int direction) {
    if (key < 0 || key > 5 || (direction != 0 && direction != 1)) {
      local_error_ = "Invalid sort request.";
      return 0;
    }
    if (!dataset_.sort_indices(order_, static_cast<anime::SortKey>(key), static_cast<anime::SortDirection>(direction))) {
      local_error_ = "All-title sort failed.";
      return 0;
    }
    local_error_.clear();
    return 1;
  }

  std::size_t count() const noexcept { return order_.size(); }

  const char* chunk_json(std::size_t offset, std::size_t limit) {
    scratch_ = dataset_.cards_json(order_, offset, std::min<std::size_t>(limit, 500));
    return scratch_.c_str();
  }

  const char* last_error() const noexcept {
    if (!local_error_.empty()) return local_error_.c_str();
    return dataset_.last_error().c_str();
  }

 private:
  anime::Dataset dataset_;
  bool schema_checked_ = false;
  std::vector<std::uint32_t> order_;
  std::string scratch_;
  std::string local_error_;
};

AllRuntime engine;

}  // namespace

extern "C" {

ANIME_EXPORT int anime_all_reset() { return engine.reset(); }
ANIME_EXPORT int anime_all_add_csv(const std::uint8_t* data, std::size_t size) { return engine.add_csv(data, size); }
ANIME_EXPORT int anime_all_finalize() { return engine.finalize(); }
ANIME_EXPORT int anime_all_sort(int key, int direction) { return engine.sort(key, direction); }
ANIME_EXPORT std::size_t anime_all_count() { return engine.count(); }
ANIME_EXPORT const char* anime_all_chunk_json(std::size_t offset, std::size_t limit) { return engine.chunk_json(offset, limit); }
ANIME_EXPORT const char* anime_all_last_error() { return engine.last_error(); }

}
