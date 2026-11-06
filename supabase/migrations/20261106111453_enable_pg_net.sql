do $$ begin create extension if not exists pg_net; exception when others then raise notice $n$pg_net không có ở môi trường test$n$; end $$;
