-- =============================================================================
-- 0002 — ss_place_order: store offer_snapshot in the app's camelCase shape.
--
-- The frontend reads order.offerSnapshot.{name,timeLimit,reducedPrice,...}
-- (see OrderReceipt / RestaurantOrderDetails). The DB row is snake_case, so we
-- build the snapshot with jsonb_build_object using camelCase keys to match the
-- Offer type exactly. Append-only fix over migration 0001.
-- =============================================================================

create or replace function public.ss_place_order(
    p_offer_id         uuid,
    p_quantity         integer,
    p_consumer_name    text default null,
    p_consumer_phone   text default null,
    p_customer_message text default '',
    p_payment_method   text default 'delivery',
    p_payment_status   text default 'pending'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid      uuid := auth.uid();
    v_offer    public.ss_offers%rowtype;
    v_profile  public.ss_profiles%rowtype;
    v_order_id uuid := gen_random_uuid();
    v_pickup   text := lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
    v_expires  timestamptz;
    v_total    numeric(10,2);
    v_hh       int;
    v_mm       int;
    v_snapshot jsonb;
begin
    if v_uid is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if p_quantity is null or p_quantity <= 0 then
        raise exception 'quantity must be positive' using errcode = '22023';
    end if;

    select * into v_profile from public.ss_profiles where id = v_uid;
    if not found then
        raise exception 'no SecondServe profile for caller' using errcode = 'P0002';
    end if;

    select * into v_offer from public.ss_offers where id = p_offer_id for update;
    if not found then
        raise exception 'offer no longer exists' using errcode = 'P0002';
    end if;
    if p_quantity > v_offer.quantity then
        raise exception 'requested quantity not available' using errcode = '23514';
    end if;

    if v_offer.time_limit ~ '^\d{1,2}:\d{2}$' then
        v_hh := split_part(v_offer.time_limit, ':', 1)::int;
        v_mm := split_part(v_offer.time_limit, ':', 2)::int;
        v_expires := date_trunc('day', now()) + make_interval(hours => v_hh, mins => v_mm);
        if v_expires <= now() then
            v_expires := v_expires + interval '1 day';
        end if;
    else
        v_expires := now() + interval '24 hours';
    end if;

    v_total := v_offer.reduced_price * p_quantity;

    -- camelCase snapshot mirroring the Offer type the frontend consumes.
    v_snapshot := jsonb_build_object(
        'id',             v_offer.id,
        'restaurantId',   v_offer.restaurant_id,
        'restaurantName', v_offer.restaurant_name,
        'name',           v_offer.name,
        'description',    v_offer.description,
        'originalPrice',  v_offer.original_price,
        'reducedPrice',   v_offer.reduced_price,
        'quantity',       v_offer.quantity,
        'image',          v_offer.image,
        'timeLimit',      v_offer.time_limit,
        'city',           v_offer.city,
        'commerceType',   v_offer.commerce_type,
        'mealCategory',   v_offer.meal_category,
        'rating',         v_offer.rating,
        'isSurpriseBox',  v_offer.is_surprise_box,
        'address',        v_offer.address,
        'coordinates',    case
                              when v_offer.lat is not null and v_offer.lng is not null
                              then jsonb_build_object('lat', v_offer.lat, 'lng', v_offer.lng)
                              else null
                          end,
        'mapLink',        v_offer.map_link
    );

    update public.ss_offers set quantity = quantity - p_quantity where id = p_offer_id;

    insert into public.ss_orders (
        id, offer_id, consumer_id, consumer_name, consumer_phone,
        restaurant_id, quantity, total_price, status, offer_snapshot,
        payment_method, payment_status, customer_message, pickup_code, expires_at
    ) values (
        v_order_id, p_offer_id, v_uid,
        coalesce(p_consumer_name, v_profile.name),
        coalesce(p_consumer_phone, v_profile.phone, '0600000000'),
        v_offer.restaurant_id, p_quantity, v_total, 'active', v_snapshot,
        coalesce(p_payment_method, 'delivery'),
        coalesce(p_payment_status, 'pending'),
        coalesce(p_customer_message, ''),
        v_pickup, v_expires
    );

    insert into public.ss_notifications (
        order_id, customer_name, offer_name, total_price, payment_method, recipient_id
    ) values (
        v_order_id,
        coalesce(p_consumer_name, v_profile.name),
        v_offer.name, v_total,
        coalesce(p_payment_method, 'delivery'),
        v_offer.restaurant_id
    );

    return v_order_id;
end;
$$;

revoke all on function public.ss_place_order(uuid, integer, text, text, text, text, text)
    from public, anon;
grant execute on function public.ss_place_order(uuid, integer, text, text, text, text, text)
    to authenticated;
