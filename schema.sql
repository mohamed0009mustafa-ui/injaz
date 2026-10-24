-- مدير الشقق: المخطط الكامل (المراحل 1-3 على مستوى قاعدة البيانات)
create extension if not exists pgcrypto;
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create or replace function set_owner() returns trigger language plpgsql as $$
begin new.owner_id = auth.uid(); return new; end $$;

create table apartments (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) default auth.uid(),
  code text not null, governorate text, area text, street text, building text, floor_no text, unit_no text,
  landlord_name text, landlord_phone text, landlord_rent numeric(12,2) not null default 0 check (landlord_rent>=0),
  lease_start date, lease_end date, rooms int, bathrooms int,
  capacity int not null check (capacity>0), expected_monthly_expenses numeric(12,2) default 0, notes text,
  archived_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique(owner_id, code));

create table residents (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) default auth.uid(),
  full_name text not null, phone text, apartment_id uuid references apartments(id),
  bed_label text, bed_type text check (bed_type in ('single','double','triple','private')),
  moved_in_at date not null default current_date, expected_out_at date, moved_out_at date,
  agreed_rent numeric(12,2) not null default 0, deposit numeric(12,2) not null default 0, notes text,
  created_at timestamptz default now(), updated_at timestamptz default now());
create unique index one_resident_per_bed on residents(apartment_id, bed_label) where moved_out_at is null and bed_label is not null;

create or replace function check_capacity() returns trigger language plpgsql as $$
declare cap int; cnt int;
begin
  if new.moved_out_at is null and new.apartment_id is not null then
    select capacity into cap from apartments where id=new.apartment_id for update;
    select count(*) into cnt from residents where apartment_id=new.apartment_id and moved_out_at is null and id<>new.id;
    if cnt >= cap then raise exception 'الشقة وصلت إلى طاقتها الاستيعابية'; end if;
  end if; return new; end $$;
create trigger residents_capacity before insert or update on residents for each row execute function check_capacity();

create table resident_transfers (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) default auth.uid(),
  resident_id uuid not null references residents(id), from_apartment uuid references apartments(id), to_apartment uuid references apartments(id),
  moved_on date not null default current_date, note text, created_at timestamptz default now());

create table task_categories (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) default auth.uid(),
  name text not null, unique(owner_id,name));

create table tasks (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) default auth.uid(),
  title text not null, description text, apartment_id uuid references apartments(id), category_id uuid references task_categories(id),
  priority text not null default 'important_not_urgent' check (priority in ('urgent_important','important_not_urgent','urgent_not_important','neither')),
  status text not null default 'new' check (status in ('new','in_progress','done','postponed','cancelled')),
  due_date date, assignee text, expected_cost numeric(12,2), actual_cost numeric(12,2), notes text,
  recurrence text check (recurrence in ('daily','weekly','monthly')), postponed_reason text,
  archived_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());

create table task_log (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) default auth.uid(),
  task_id uuid not null references tasks(id), event text not null, detail jsonb, created_at timestamptz default now());
create or replace function log_task() returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then insert into task_log(owner_id,task_id,event) values(new.owner_id,new.id,'created');
  elsif old.status is distinct from new.status then insert into task_log(owner_id,task_id,event,detail) values(new.owner_id,new.id,'status',jsonb_build_object('from',old.status,'to',new.status)); end if;
  return new; end $$;
create trigger tasks_log after insert or update on tasks for each row execute function log_task();

create table transactions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) default auth.uid(),
  kind text not null check (kind in ('income','expense')), amount numeric(12,2) not null check (amount>0),
  tx_date date not null default current_date, apartment_id uuid references apartments(id), category text not null,
  counterparty text, description text, reference_no text, notes text,
  task_id uuid unique references tasks(id),
  is_refundable_deposit boolean not null default false, voided_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table payments (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) default auth.uid(),
  transaction_id uuid not null references transactions(id), amount numeric(12,2) not null check (amount>0),
  paid_on date not null default current_date, method text, idempotency_key text, created_at timestamptz default now(),
  unique(owner_id, idempotency_key));
create or replace function check_payment() returns trigger language plpgsql as $$
declare total numeric; due numeric;
begin
  select amount into due from transactions where id=new.transaction_id for update;
  select coalesce(sum(amount),0) into total from payments where transaction_id=new.transaction_id;
  if total + new.amount > due then raise exception 'إجمالي الدفعات يتجاوز المبلغ المستحق'; end if; return new; end $$;
create trigger payments_check before insert on payments for each row execute function check_payment();

create view transaction_status with (security_invoker=true) as
select t.*, coalesce(sum(p.amount),0) paid, t.amount-coalesce(sum(p.amount),0) remaining,
 case when coalesce(sum(p.amount),0)=0 then 'unpaid' when coalesce(sum(p.amount),0)<t.amount then 'partial' else 'paid' end pay_status
from transactions t left join payments p on p.transaction_id=t.id group by t.id;

-- updated_at + RLS (المالك فقط). لا سياسة delete للمعاملات والدفعات: الإلغاء المنطقي فقط.
do $$ declare t text; begin
 foreach t in array array['apartments','residents','tasks','transactions'] loop
  execute format('create trigger %I_upd before update on %I for each row execute function set_updated_at()',t,t); end loop;
 foreach t in array array['apartments','residents','resident_transfers','task_categories','tasks','task_log','transactions','payments'] loop
  execute format('alter table %I enable row level security',t);
  execute format('create trigger %I_own before insert on %I for each row execute function set_owner()',t,t);
  execute format('create policy "own select" on %I for select using (owner_id=auth.uid())',t);
  execute format('create policy "own insert" on %I for insert with check (owner_id=auth.uid())',t);
 end loop;
 foreach t in array array['apartments','residents','tasks','transactions','task_categories'] loop
  execute format('create policy "own update" on %I for update using (owner_id=auth.uid()) with check (owner_id=auth.uid())',t); end loop;
 foreach t in array array['task_categories','tasks'] loop
  execute format('create policy "own delete" on %I for delete using (owner_id=auth.uid())',t); end loop;
end $$;
