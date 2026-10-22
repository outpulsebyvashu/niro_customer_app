-- Sample data for development: the five Mysuru cafes from the mock.
-- Coordinates are approximate placeholders. Replace them with each cafe's real location.
insert into cafes (id, name, slug, kind, area, city, lat, lng, opens, closes, brand, reward_text) values
 ('agr','Agrahara Roasters','agrahara-roasters','cafe','Saraswathipuram','Mysuru',12.3124,76.6277,'08:00','22:00',
   '{"bg":"#3b2418","ink":"#f6e7d4","acc":"#d9a066","pattern":"rings"}','Free filter coffee'),
 ('kaa','Kaapi Kutir','kaapi-kutir','cafe','Vijayanagar','Mysuru',12.3302,76.6045,'07:00','21:30',
   '{"bg":"#1f4d3a","ink":"#f3ecd9","acc":"#e7b84a","pattern":"stripes"}','Free filter coffee'),
 ('cru','Crumb & Co','crumb-and-co','cafe','Kuvempunagar','Mysuru',12.2884,76.6213,'09:00','23:00',
   '{"bg":"#f4e3c3","ink":"#4a2c14","acc":"#c8553d","pattern":"dots"}','Free slice of cake'),
 ('cha','Chamundi Chai Bar','chamundi-chai-bar','cafe','Jayalakshmipuram','Mysuru',12.3050,76.6360,'07:00','21:00',
   '{"bg":"#c2410c","ink":"#fff4e6","acc":"#ffd8a8","pattern":"rings"}','Free masala chai'),
 ('waf','Waffle Lane','waffle-lane','cafe','Gokulam','Mysuru',12.3236,76.6174,'10:00','22:00',
   '{"bg":"#2b2f6b","ink":"#ffe9f1","acc":"#ff8fb3","pattern":"grid"}','Free waffle');

insert into offers (id, cafe_id, title, ends_at) values
 ('o1','agr','Free pastry with any 2 coffees',   strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 days')),
 ('o2','kaa','Double stamps before 11 am',       strftime('%Y-%m-%dT%H:%M:%fZ','now','+3 days')),
 ('o3','cru','Second slice at half price',       strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day')),
 ('o4','cha','Masala chai at ₹49 for members',   strftime('%Y-%m-%dT%H:%M:%fZ','now','+7 days')),
 ('o5','waf','Free topping on your first visit', strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days'));
