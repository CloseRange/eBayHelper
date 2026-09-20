create table listing (
    title varchar(255) not null,
    description text,
    price numeric(10, 2) not null,
    bin numeric(3, 0),
    sn integer not null,
    sku varchar(14) unique not null primary key,
    category_id varchar(50),
    condition varchar(50),
    aspects jsonb,
    state varchar(50) default 'processing',
    created_at timestamp default current_timestamp
);
create table old_listing (
    title varchar(255) not null,
    description text,
    price numeric(10, 2) not null,
    bin numeric(3, 0),
    sn integer not null,
    sku varchar(14) unique not null primary key,
    category_id varchar(50),
    condition varchar(50),
    aspects jsonb,
    state varchar(50) default 'processing',
    created_at timestamp default current_timestamp
);

create table listing_image (
    id serial primary key,
    sku varchar(14) references listing(sku) on delete cascade,
    image_url text not null,
    image_order integer not null
);

-- Load all listing rows, with lower bin values at the bottom.
select *
from listing
order by bin desc nulls last;


