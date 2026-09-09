#include "../shared/anime_engine.hpp"

#include <cassert>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <iostream>
#include <string>

namespace {

std::string sample_csv() {
  return
      "id,title_ja,title_kana,media_type,release_start,episode_count,runtime_min,animation_studio,image_url,genres,characters,staff,streaming_services\r\n"
      "A00000001,春の作品,はるのさくひん,TV,2027-04-05,12,24,Studio A,,青春,主人公::MAIN::声優A,監督::監督A,Service A::通常::日本::2027-04-05::\r\n"
      "A00000002,\"秋,作品\",あきさくひん,MOVIE,2027-10-01,,110,Studio B,,冒険,主人公::MAIN::声優B,監督::監督B,Service B::独占::日本::2027-10-01::\r\n"
      "A00000003,冬の作品,ふゆのさくひん,ONA,2027-01-10,6,20,Studio C,,SF,主人公::MAIN::声優C,監督::監督C,Service C::通常::日本::2027-01-10::\r\n";
}

std::string make_benchmark_csv(std::size_t rows) {
  std::string csv = "id,title_ja,title_kana,media_type,release_start,episode_count,runtime_min,animation_studio,image_url,genres,characters,staff,streaming_services\n";
  csv.reserve(rows * 170);
  for (std::size_t i = 0; i < rows; ++i) {
    const int month = static_cast<int>((i % 12) + 1);
    char id[16];
    std::snprintf(id, sizeof(id), "A%08zu", i + 1);
    char date[16];
    std::snprintf(date, sizeof(date), "2027-%02d-01", month);
    csv += id;
    csv += ",作品" + std::to_string(i) + ",さくひん" + std::to_string(i) + ",TV,";
    csv += date;
    csv += ",12,24,Studio ";
    csv += char('A' + (i % 26));
    csv += ",,ジャンル,主人公::MAIN::声優,監督::監督,Service::通常::日本::2027-01-01::\n";
  }
  return csv;
}

}  // namespace

int main() {
  const std::string csv = sample_csv();

  anime::AllEngine all;
  assert(all.reset() == 1);
  assert(all.add_csv(reinterpret_cast<const std::uint8_t*>(csv.data()), csv.size()) == 1);
  assert(all.finalize() == 1);
  assert(all.count() == 3);
  const std::string cards = all.chunk_json(0, 100);
  assert(cards.find("A00000001") != std::string::npos);
  assert(cards.find("2027春") != std::string::npos);
  assert(all.sort(static_cast<int>(anime::SortKey::Runtime), static_cast<int>(anime::SortDirection::Desc)) == 1);

  anime::SearchEngine search;
  assert(search.reset() == 1);
  assert(search.add_csv(reinterpret_cast<const std::uint8_t*>(csv.data()), csv.size()) == 1);
  assert(search.finalize() == 1);
  assert(search.add_text_term("studio b", "studio", static_cast<int>(anime::MatchMode::Contains), 0) == 1);
  assert(search.execute() == 1);
  assert(search.count() == 1);
  assert(std::string(search.record_json_by_id("A00000002")).find("秋,作品") != std::string::npos);

  assert(search.clear_terms() == 1);
  assert(search.add_date_range("release_start", "2027-04-01", "2027-12-31", 0) == 1);
  assert(search.execute() == 1);
  assert(search.count() == 2);

  anime::AllEngine transactional;
  assert(transactional.reset() == 1);
  assert(transactional.add_csv(reinterpret_cast<const std::uint8_t*>(csv.data()), csv.size()) == 1);
  const std::string duplicate =
      "id,title_ja,title_kana,media_type,release_start,episode_count,runtime_min,animation_studio,image_url,genres,characters,staff,streaming_services\n"
      "A00000001,重複,,,,,,,,,,,,\n";
  assert(transactional.add_csv(reinterpret_cast<const std::uint8_t*>(duplicate.data()), duplicate.size()) == 0);
  assert(transactional.finalize() == 1);
  assert(transactional.count() == 3);

  const std::string benchmark = make_benchmark_csv(20000);
  anime::SearchEngine perf;
  perf.reset();
  const auto parse_start = std::chrono::steady_clock::now();
  assert(perf.add_csv(reinterpret_cast<const std::uint8_t*>(benchmark.data()), benchmark.size()) == 1);
  assert(perf.finalize() == 1);
  const auto parse_end = std::chrono::steady_clock::now();

  assert(perf.add_text_term("Studio Z", "studio", static_cast<int>(anime::MatchMode::Contains), 0) == 1);
  const auto search_start = std::chrono::steady_clock::now();
  assert(perf.execute() == 1);
  const auto search_end = std::chrono::steady_clock::now();

  const auto parse_ms = std::chrono::duration_cast<std::chrono::milliseconds>(parse_end - parse_start).count();
  const auto search_ms = std::chrono::duration_cast<std::chrono::milliseconds>(search_end - search_start).count();
  std::cout << "benchmark_records=20000 parse_ms=" << parse_ms
            << " search_ms=" << search_ms
            << " matches=" << perf.count() << '\n';
  std::cout << "engine_test: PASS\n";
  return 0;
}
