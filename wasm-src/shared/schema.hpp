#pragma once

#include "anime_engine.hpp"

#include <array>
#include <cstddef>
#include <string>
#include <string_view>

namespace anime::schema {

inline constexpr std::array<std::string_view, 70> kColumns = {
    "id", "title_ja", "title_kana", "title_romaji", "title_en", "aliases",
    "media_type", "release_start", "release_end", "episode_count", "runtime_min",
    "series_id", "season_number",
    "genres", "tags", "target_demographic", "setting", "era", "themes",
    "original_type", "original_title", "original_author", "original_artist",
    "original_publisher", "original_label", "original_magazine", "original_platform",
    "animation_studio", "co_animation_studio", "animation_cooperation", "production_name",
    "production_committee", "production_members", "production_lead_company", "planning",
    "executive_producers", "producers", "animation_producers", "line_producers",
    "director", "chief_director", "series_composition", "character_original_design",
    "character_design", "music", "sound_director", "staff", "characters",
    "opening_themes", "ending_themes", "insert_songs", "music_production",
    "soundtrack_label", "broadcast_networks", "broadcast_slots", "streaming_services",
    "film_distributor", "theatrical_release_date", "relations", "episodes",
    "episode_staff", "awards", "synopsis", "image_url", "official_url", "official_x",
    "official_youtube", "official_other", "external_ids", "updated_at"};

inline bool validate_common_schema(const Dataset& dataset, std::string& error) {
  if (dataset.column_count() != kColumns.size()) {
    error = "CSV schema column count mismatch: expected " + std::to_string(kColumns.size()) +
            ", got " + std::to_string(dataset.column_count()) + ".";
    return false;
  }

  for (std::size_t index = 0; index < kColumns.size(); ++index) {
    const int actual = dataset.column_index(kColumns[index]);
    if (actual != static_cast<int>(index)) {
      error = "CSV schema header/order mismatch at column " + std::to_string(index + 1) +
              ": expected " + std::string(kColumns[index]) + ".";
      return false;
    }
  }

  error.clear();
  return true;
}

}  // namespace anime::schema
