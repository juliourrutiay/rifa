create table if not exists public.raffle_tickets (
  id bigint generated always as identity primary key,
  raffle_id text not null,
  number integer not null,
  status text not null default 'available' check (status in ('available', 'reserved', 'paid')),
  payer_name text,
  payer_email text,
  payer_phone text,
  payer_rut text,
  payment_id text,
  transaction_id text,
  payment_channel text check (payment_channel in ('khipu', 'manual') or payment_channel is null),
  notes text,
  reserved_until timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (raffle_id, number)
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_raffle_tickets_updated_at on public.raffle_tickets;
create trigger set_raffle_tickets_updated_at
before update on public.raffle_tickets
for each row execute function public.set_updated_at();
