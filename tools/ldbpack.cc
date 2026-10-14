// ldbpack: build or dump a LevelDB database (Foundry VTT compendium pack format).
//   ldbpack write <dbdir> <input>  — input alternates lines: key, then JSON value
//   ldbpack dump  <dbdir>          — prints key<TAB>value per line
#include <leveldb/db.h>
#include <leveldb/write_batch.h>
#include <fstream>
#include <iostream>
#include <string>
int main(int argc, char** argv) {
  if (argc < 3) { std::cerr << "usage: ldbpack write|dump <dbdir> [input]\n"; return 2; }
  std::string mode = argv[1], dir = argv[2];
  leveldb::Options opt; opt.create_if_missing = (mode == "write"); opt.error_if_exists = (mode == "write");
  leveldb::DB* db; leveldb::Status s = leveldb::DB::Open(opt, dir, &db);
  if (!s.ok()) { std::cerr << s.ToString() << "\n"; return 1; }
  if (mode == "write") {
    std::ifstream in(argv[3]); std::string k, v; leveldb::WriteBatch b; int n = 0;
    while (std::getline(in, k) && std::getline(in, v)) { b.Put(k, v); n++; }
    s = db->Write(leveldb::WriteOptions(), &b);
    if (!s.ok()) { std::cerr << s.ToString() << "\n"; return 1; }
    db->CompactRange(nullptr, nullptr);
    std::cerr << "wrote " << n << " entries\n";
  } else {
    leveldb::Iterator* it = db->NewIterator(leveldb::ReadOptions());
    for (it->SeekToFirst(); it->Valid(); it->Next()) std::cout << it->key().ToString() << "\t" << it->value().ToString() << "\n";
    delete it;
  }
  delete db; return 0;
}
