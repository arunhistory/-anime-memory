#include "../shared/anime_engine.hpp"

#include <cassert>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

const std::vector<std::string>& headers() {
  static const std::vector<std::string> value = {
      "id", "title_ja", "title_kana", "title_romaji", "title_en", "aliases",
      "media_type", "release_start", "release_end", "episode_count", "runtime_min",
      "series_id", "season_number", "genres", "tags", "target_demographic", "setting",
      "era", "themes", "original_type", "original_title", "original_author", "original_artist",
      "original_publisher", "original_label", "original_magazine", "original_platform",
      "animation_studio", "co_animation_studio", "animation_cooperation", "production_name",
      "production_committee", "production_members", "production_lead_company", "planning",
      "executive_producers", "producers", "animation_producers", "line_producers", "director",
      "chief_director", "series_composition", "character_original_design", "character_design",
      "music", "sound_director", "staff", "characters", "opening_themes", "ending_themes",
      "insert_songs", "music_production", "soundtrack_label", "broadcast_networks",
      "broadcast_slots", "streaming_services", "film_distributor", "theatrical_release_date",
      "relations", "episodes", "episode_staff", "awards", "synopsis", "image_url",
      "official_url", "official_x", "official_youtube", "official_other", "external_ids",
      "updated_at"};
  return value;
}

std::string csv_escape(const std::string& value) {
  if (value.find_first_of(",\"\r\n") == std::string::npos) return value;
  std::string out = "\"";
  for (const char c : value) {
    if (c == '"') out += "\"\"";
    else out.push_back(c);
  }
  out.push_back('"');
  return out;
}

std::string header_line() {
  std::string out;
  for (std::size_t i = 0; i < headers().size(); ++i) {
    if (i) out.push_back(',');
    out += headers()[i];
  }
  out.push_back('\n');
  return out;
}

std::string row(const std::unordered_map<std::string, std::string>& fields) {
  std::string out;
  for (std::size_t i = 0; i < headers().size(); ++i) {
    if (i) out.push_back(',');
    const auto found = fields.find(headers()[i]);
    if (found != fields.end()) out += csv_escape(found->second);
  }
  out.push_back('\n');
  return out;
}

std::string sample_csv() {
  std::string csv = header_line();
  csv += row({
      {"id", "A00000001"}, {"title_ja", "春の作品"}, {"title_kana", "はるのさくひん"},
      {"title_en", "Spring Work"}, {"media_type", "TV"}, {"release_start", "2027-04-05"},
      {"episode_count", "12"}, {"runtime_min", "24"}, {"series_id", "S0001"}, {"season_number", "1"},
      {"genres", "青春|日常"}, {"original_type", "漫画"}, {"original_author", "作者A"},
      {"animation_studio", "Studio A"}, {"production_committee", "春作品製作委員会"},
      {"production_members", "会社A|会社B"}, {"director", "監督A"},
      {"staff", "監督::監督A|脚本::脚本A"}, {"characters", "主人公::MAIN::声優A"},
      {"opening_themes", "OP::春の歌::歌手A::作詞A::作曲A::編曲A"},
      {"broadcast_networks", "放送局A"}, {"broadcast_slots", "放送局A::月曜23:00"},
      {"streaming_services", "Service A::通常::日本::2027-04-05::"},
      {"relations", "SEQUEL::A00000003"}, {"episodes", "1::はじまり::2027-04-05"},
      {"episode_staff", "1::脚本::脚本A"}, {"awards", "2027::賞A::受賞"},
      {"synopsis", "春から始まる物語"}, {"official_url", "https://example.invalid/a"},
      {"external_ids", "source::1001"}, {"updated_at", "2027-04-01"}});
  csv += row({
      {"id", "A00000002"}, {"title_ja", "秋,作品"}, {"title_kana", "あきさくひん"},
      {"title_romaji", "Aki"}, {"media_type", "MOVIE"}, {"release_start", "2027-10-01"},
      {"runtime_min", "110"}, {"genres", "冒険"}, {"original_type", "オリジナル"},
      {"animation_studio", "Studio B"}, {"production_name", "Production B"},
      {"production_committee", "秋映画製作委員会"}, {"director", "監督B"},
      {"staff", "監督::監督B|音響監督::音監B"}, {"characters", "主人公::MAIN::声優B|友人::SUPPORT::声優C"},
      {"ending_themes", "ED::秋の歌::歌手B::作詞B::作曲B::編曲B"},
      {"streaming_services", "Service B::独占::日本::2028-01-01::"},
      {"film_distributor", "配給B"}, {"theatrical_release_date", "2027-10-01"},
      {"awards", "2028::映画賞::大賞"}, {"synopsis", "秋の劇場物語"},
      {"official_x", "https://x.example.invalid/b"}, {"external_ids", "source::2002"},
      {"updated_at", "2027-09-15"}});
  csv += row({
      {"id", "A00000003"}, {"title_ja", "冬の作品"}, {"title_kana", "ふゆのさくひん"},
      {"aliases", "冬作品|Winter"}, {"media_type", "ONA"}, {"release_start", "2027-01"},
      {"episode_count", "6"}, {"runtime_min", "20"}, {"series_id", "S0001"}, {"season_number", "2"},
      {"genres", "SF"}, {"animation_studio", "Studio C"}, {"animation_cooperation", "協力C"},
      {"characters", "主人公::MAIN::声優D"}, {"insert_songs", "IN::冬の歌::歌手C::作詞C::作曲C::編曲C"},
      {"streaming_services", "Service C::最速::日本::2027-01-10::"},
      {"relations", "PREQUEL::A00000001"}, {"updated_at", "2027-01-02"}});
  return csv;
}

std::string benchmark_csv(std::size_t rows) {
  std::string csv = header_line();
  csv.reserve(rows * 320);
  for (std::size_t i = 0; i < rows; ++i) {
    char id[16];
    std::snprintf(id, sizeof(id), "A%08zu", i + 1);
    char date[16];
    std::snprintf(date, sizeof(date), "2027-%02zu-01", (i % 12) + 1);
    csv += row({
        {"id", id}, {"title_ja", "作品" + std::to_string(i)}, {"title_kana", "さくひん" + std::to_string(i)},
        {"media_type", "TV"}, {"release_start", date}, {"episode_count", "12"}, {"runtime_min", "24"},
        {"genres", "ジャンル"}, {"animation_studio", std::string("Studio ") + char('A' + (i % 26))},
        {"production_committee", "製作委員会"}, {"characters", "主人公::MAIN::声優"},
        {"staff", "監督::監督"}, {"streaming_services", "Service::通常::日本::2027-01-01::"},
        {"updated_at", "2027-01-01"}});
  }
  return csv;
}

void add_csv(anime::AllEngine& engine, const std::string& csv) {
  assert(engine.add_csv(reinterpret_cast<const std::uint8_t*>(csv.data()), csv.size()) == 1);
}

void add_csv(anime::SearchEngine& engine, const std::string& csv) {
  assert(engine.add_csv(reinterpret_cast<const std::uint8_t*>(csv.data()), csv.size()) == 1);
}

}  // namespace

int main() {
  const std::string csv = sample_csv();

  anime::AllEngine all;
  assert(all.reset() == 1);
  add_csv(all, csv);
  assert(all.finalize() == 1);
  assert(all.count() == 3);
  assert(std::string(all.chunk_json(0, 100)).find("2027春") != std::string::npos);

  anime::SearchEngine search;
  assert(search.reset() == 1);
  add_csv(search, csv);
  assert(search.finalize() == 1);

  assert(search.add_text_term("声優B", "cast", static_cast<int>(anime::MatchMode::Exact), 0) == 1);
  assert(search.execute() == 1);
  assert(search.count() == 1);
  assert(std::string(search.record_json_by_id("A00000002")).find("秋,作品") != std::string::npos);

  assert(search.clear_terms() == 1);
  assert(search.add_text_term("配給B", "theater", static_cast<int>(anime::MatchMode::Exact), 0) == 1);
  assert(search.execute() == 1 && search.count() == 1);

  assert(search.clear_terms() == 1);
  assert(search.add_text_term("映画賞", "awards", static_cast<int>(anime::MatchMode::Exact), 0) == 1);
  assert(search.execute() == 1 && search.count() == 1);

  assert(search.clear_terms() == 1);
  assert(search.add_date_range("release_start", "2027-04", "2027-12", 0) == 1);
  assert(search.execute() == 1 && search.count() == 2);

  assert(search.clear_terms() == 1);
  assert(search.add_number_range("runtime_min", "100", "120", 0) == 1);
  assert(search.execute() == 1 && search.count() == 1);

  assert(search.clear_terms() == 1);
  assert(search.set_combine_mode(static_cast<int>(anime::CombineMode::And)) == 1);
  assert(search.add_text_term("Studio B", "studio", static_cast<int>(anime::MatchMode::Exact), 1) == 1);
  assert(search.add_text_term("作品", "title", static_cast<int>(anime::MatchMode::Contains), 0) == 1);
  assert(search.execute() == 1 && search.count() == 2);

  assert(search.clear_terms() == 1);
  assert(search.add_text_term("作品", "title", static_cast<int>(anime::MatchMode::Contains), 0) == 1);
  assert(search.execute() == 1 && search.count() == 3);
  for (int key = 0; key <= 5; ++key) {
    for (int direction = 0; direction <= 1; ++direction) {
      assert(all.sort(key, direction) == 1);
      assert(search.sort(key, direction) == 1);
      assert(std::string(all.chunk_json(0, 100)) == std::string(search.chunk_json(0, 100)));
    }
  }

  anime::AllEngine transactional;
  assert(transactional.reset() == 1);
  add_csv(transactional, csv);
  std::string duplicate = header_line();
  duplicate += row({{"id", "A00000001"}, {"title_ja", "重複"}});
  assert(transactional.add_csv(reinterpret_cast<const std::uint8_t*>(duplicate.data()), duplicate.size()) == 0);
  assert(transactional.finalize() == 1);
  assert(transactional.count() == 3);

  anime::AllEngine invalid_schema;
  assert(invalid_schema.reset() == 1);
  std::string bad = header_line();
  const std::size_t comma = bad.find(',');
  bad.replace(0, comma, "title_ja");
  assert(invalid_schema.add_csv(reinterpret_cast<const std::uint8_t*>(bad.data()), bad.size()) == 0);

  anime::AllEngine invalid_id;
  assert(invalid_id.reset() == 1);
  std::string bad_id = header_line();
  bad_id += row({{"id", "bad-id"}, {"title_ja", "不正"}});
  assert(invalid_id.add_csv(reinterpret_cast<const std::uint8_t*>(bad_id.data()), bad_id.size()) == 0);

  const std::string benchmark = benchmark_csv(20000);
  anime::SearchEngine perf;
  perf.reset();
  const auto parse_start = std::chrono::steady_clock::now();
  add_csv(perf, benchmark);
  assert(perf.finalize() == 1);
  const auto parse_end = std::chrono::steady_clock::now();
  assert(perf.add_text_term("Studio Z", "studio", static_cast<int>(anime::MatchMode::Exact), 0) == 1);
  const auto search_start = std::chrono::steady_clock::now();
  assert(perf.execute() == 1);
  const auto search_end = std::chrono::steady_clock::now();

  const auto parse_ms = std::chrono::duration_cast<std::chrono::milliseconds>(parse_end - parse_start).count();
  const auto search_ms = std::chrono::duration_cast<std::chrono::milliseconds>(search_end - search_start).count();
  std::cout << "benchmark_records=20000 parse_ms=" << parse_ms << " search_ms=" << search_ms
            << " matches=" << perf.count() << '\n';
  std::cout << "engine_v2_test: PASS\n";
  return 0;
}
