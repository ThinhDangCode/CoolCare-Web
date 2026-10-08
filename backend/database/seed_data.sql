-- COOLCARE DEMO v2 — Can Tho after the 2025 administrative merger, 12 accounts, 20 bookings.
-- Run ONCE after the team's finalized CoolCare_database_final.sql, on a fresh demo DB.
-- All persons, phones, addresses, certificates and payment references are synthetic.
-- Do not send SMS/email or call payment providers for these records.
-- Demo login password: CoolCare@123 (BCrypt, cost 10, random salt per account).
-- No schema changes, disabled triggers or changes to business functions.
BEGIN;
SET LOCAL TIME ZONE 'Asia/Ho_Chi_Minh';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM bookings)
       OR EXISTS (SELECT 1 FROM services) OR EXISTS (SELECT 1 FROM technician_accounts) THEN
        RAISE EXCEPTION 'Seed requires a fresh demo database. Existing data detected; nothing was added.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM roles WHERE code='ADMIN')
       OR NOT EXISTS (SELECT 1 FROM roles WHERE code='CUSTOMER')
       OR (SELECT count(*) FROM payment_methods WHERE code IN ('CASH','VNPAY','ZALOPAY','FREE'))<>4 THEN
        RAISE EXCEPTION 'Run the finalized team schema with its master data first.';
    END IF;
END;
$$;

-- Session-only deterministic IDs make links and demo scenarios easy to inspect.
CREATE FUNCTION pg_temp.demo_id(k text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$ SELECT md5('coolcare-demo-v1:' || k)::uuid $$;

DO $$
DECLARE
    i integer; j integer; k integer; n integer; c integer; t integer; s integer; extra_s integer;
    unit_count integer; brand_n integer;
    uid uuid; cid uuid; tid uuid; aid uuid; bid uuid; qid uuid; qextra uuid;
    unit_id uuid; bus_id uuid; pid uuid; inv_id uuid; cert_id uuid; row_id uuid;
    selected_voucher uuid; method_id uuid; cat uuid;
    names text[] := ARRAY['Nguyễn Minh An','Trần Ngọc Bình','Lê Hoài Chi','Phạm Gia Dũng',
        'Nguyễn Thanh Hải','Trần Quốc Huy','Lê Minh Khang','Phạm Tuấn Kiệt','Võ Thành Long','Đặng Hoàng Minh'];
    wards text[] := ARRAY['Phường Ninh Kiều','Phường Cái Khế','Phường Tân An','Phường An Bình',
        'Phường Bình Thủy','Phường Long Tuyền','Phường Cái Răng','Phường Hưng Phú',
        'Phường Ô Môn','Phường Sóc Trăng'];
    brands text[] := ARRAY['Daikin','Panasonic','LG','Samsung','Toshiba'];
    service_names text[] := ARRAY['Vệ sinh máy lạnh','Kiểm tra/chẩn đoán','Bảo dưỡng máy lạnh','Sửa chữa cơ bản'];
    service_prices numeric[] := ARRAY[150000,100000,250000,200000];
    skill_names text[] := ARRAY['Vệ sinh dàn lạnh','Vệ sinh dàn nóng','Kiểm tra nguồn điện','Chẩn đoán lỗi máy',
        'Kiểm tra hiệu suất','Bảo dưỡng đường thoát nước','Xử lý rò nước','Khắc phục lỗi hoạt động'];
    v_status text; b_status text; source_method text;
    subtotal_value numeric; parts_value numeric; balance_value numeric;
    week_start timestamptz := date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
    origin timestamptz := CURRENT_TIMESTAMP - interval '60 days';
BEGIN
    -- 1. Accounts. Customers 05..10 also have technician profiles.
    FOR i IN 1..2 LOOP
        INSERT INTO users(id,role_id,email,email_verified_at,phone,phone_verified_at,password_hash,full_name,created_at,updated_at)
        VALUES(pg_temp.demo_id('admin-'||i),(SELECT id FROM roles WHERE code='ADMIN'),
            'admin'||lpad(i::text,2,'0')||'@example.com',origin,'09099000'||lpad((10+i)::text,2,'0'),origin,
            crypt('CoolCare@123',gen_salt('bf',10)),'Quản trị demo '||i,origin,origin);
    END LOOP;
    FOR i IN 1..10 LOOP
        uid:=pg_temp.demo_id('user-'||i); cid:=pg_temp.demo_id('customer-'||i);
        INSERT INTO users(id,role_id,email,email_verified_at,phone,phone_verified_at,password_hash,full_name,created_at,updated_at)
        VALUES(uid,(SELECT id FROM roles WHERE code='CUSTOMER'),'customer'||lpad(i::text,2,'0')||'@example.com',
            origin,'09099000'||lpad(i::text,2,'0'),origin,crypt('CoolCare@123',gen_salt('bf',10)),names[i],origin,origin);
        INSERT INTO customer_profiles(id,user_id,date_of_birth,gender,created_at,updated_at)
        VALUES(cid,uid,make_date(1990+i,1+i,10),CASE WHEN i IN (2,3) THEN 'FEMALE' ELSE 'MALE' END,origin,origin);
        FOR j IN 1..CASE WHEN i<=5 THEN 2 ELSE 1 END LOOP
            INSERT INTO customer_addresses(id,customer_id,recipient_name,phone,address_line,ward,city,is_default,created_at,updated_at)
            VALUES(pg_temp.demo_id('address-'||i||'-'||j),cid,names[i],'09099000'||lpad(i::text,2,'0'),
                'Số '||(i*10+j)||', đường Demo '||i,wards[i],'Thành phố Cần Thơ',j=1,origin,origin);
        END LOOP;
    END LOOP;

    -- 2. Service catalog, brands and explicitly fictional model names.
    cat:=pg_temp.demo_id('category');
    INSERT INTO service_categories(id,name,description) VALUES(cat,'Dịch vụ máy lạnh','Danh mục và giá giả lập cho demo đồ án');
    FOR i IN 1..4 LOOP
        INSERT INTO services(id,category_id,name,description,base_price,estimated_duration,maintenance_interval_days)
        VALUES(pg_temp.demo_id('service-'||i),cat,service_names[i],'Giá cơ bản demo; linh kiện cần báo giá và khách đồng ý riêng.',
            service_prices[i],CASE WHEN i=2 THEN 30 ELSE 60 END,CASE WHEN i IN (1,3) THEN 180 ELSE NULL END);
        FOR j IN 1..2 LOOP
            INSERT INTO skills(id,service_id,name) VALUES(pg_temp.demo_id('skill-'||i||'-'||j),pg_temp.demo_id('service-'||i),skill_names[(i-1)*2+j]);
        END LOOP;
    END LOOP;
    FOR i IN 1..5 LOOP
        INSERT INTO ac_brands(id,name,description) VALUES(pg_temp.demo_id('brand-'||i),brands[i],'Hãng dùng trong danh mục demo');
        FOR j IN 1..2 LOOP
            INSERT INTO ac_models(id,brand_id,model_name,ac_type,capacity_btu,inverter,description)
            VALUES(pg_temp.demo_id('model-'||i||'-'||j),pg_temp.demo_id('brand-'||i),'DEMO-'||upper(brands[i])||'-'||j,
                'WALL_MOUNTED',CASE WHEN j=1 THEN 9000 ELSE 12000 END,j=2,'Mã model giả lập, không phải thông số sản phẩm thực tế');
        END LOOP;
    END LOOP;

    -- 3. Four verified technicians, one submitted, one draft (PENDING + no submitted_at).
    FOR i IN 1..6 LOOP
        tid:=pg_temp.demo_id('tech-'||i);
        INSERT INTO technician_profiles(id,user_id,identity_number,identity_front_url,identity_back_url,qualification_level,bio,
            years_experience,verification_status,reviewed_by_id,reviewed_at,submitted_at,availability_status,is_active,created_at,updated_at)
        VALUES(tid,pg_temp.demo_id('user-'||(i+4)),CASE WHEN i<=5 THEN '00000000000'||i ELSE NULL END,
            CASE WHEN i<=5 THEN 'https://example.com/demo/identity-'||i||'-front.png' ELSE NULL END,
            CASE WHEN i<=5 THEN 'https://example.com/demo/identity-'||i||'-back.png' ELSE NULL END,
            CASE WHEN i<=4 THEN 'INTERMEDIATE' ELSE 'BEGINNER' END,'Hồ sơ kỹ thuật viên giả lập tại Cần Thơ',
            CASE WHEN i<=4 THEN i+1 ELSE 0 END,CASE WHEN i<=4 THEN 'VERIFIED' ELSE 'PENDING' END,
            CASE WHEN i<=4 THEN pg_temp.demo_id('admin-1') ELSE NULL END,
            CASE WHEN i<=4 THEN origin+interval '2 days' ELSE NULL END,
            CASE WHEN i<=5 THEN origin+interval '1 day' ELSE NULL END,
            CASE WHEN i<=4 THEN 'ONLINE' ELSE 'OFFLINE' END,i<=4,origin,CURRENT_TIMESTAMP);
        INSERT INTO technician_accounts(id,technician_id,is_receiving_jobs_allowed,created_at)
        VALUES(pg_temp.demo_id('account-'||i),tid,i<=4,origin);
        INSERT INTO technician_areas(id,technician_id,city,ward)
        VALUES(pg_temp.demo_id('area-'||i),tid,'Thành phố Cần Thơ',wards[i]);
        IF i<=5 THEN
            cert_id:=pg_temp.demo_id('certificate-'||i);
            INSERT INTO technician_certifications(id,technician_id,certificate_name,certificate_number,issued_by,issued_date,
                expiry_date,document_url,verification_status,reviewed_by_id,reviewed_at,created_at)
            VALUES(cert_id,tid,'Chứng chỉ điện lạnh demo','DEMO-CERT-'||i,'Đơn vị đào tạo giả lập',
                CURRENT_DATE-365,CURRENT_DATE+365,'https://example.com/demo/certificate-'||i||'.pdf',
                CASE WHEN i<=4 THEN 'VERIFIED' ELSE 'PENDING' END,
                CASE WHEN i<=4 THEN pg_temp.demo_id('admin-1') ELSE NULL END,
                CASE WHEN i<=4 THEN origin+interval '2 days' ELSE NULL END,origin);
            INSERT INTO technician_certification_submissions(id,certification_id,submission_number,certificate_name,
                certificate_number,issued_by,issued_date,expiry_date,document_url,verification_status,submitted_at,reviewed_by_id,reviewed_at)
            SELECT pg_temp.demo_id('certificate-submission-'||i),id,1,certificate_name,certificate_number,issued_by,issued_date,
                expiry_date,document_url,verification_status,origin+interval '1 day',reviewed_by_id,reviewed_at
            FROM technician_certifications WHERE id=cert_id;
            FOR j IN 1..4 LOOP
                FOR k IN 1..5 LOOP
                    INSERT INTO technician_skills(id,technician_id,skill_id,ac_brand_id,skill_level)
                    VALUES(pg_temp.demo_id('techskill-'||i||'-'||j||'-'||k),tid,pg_temp.demo_id('skill-'||j||'-1'),pg_temp.demo_id('brand-'||k),'INTERMEDIATE');
                END LOOP;
            END LOOP;
        END IF;
    END LOOP;

    -- Historical opening debt fixtures only; do not pretend these are real payments.
    -- Insert before closing periods. ADJUSTMENT has no payment/topup source.
    FOR i IN 3..4 LOOP
        aid:=pg_temp.demo_id('account-'||i);
        INSERT INTO settlement_transactions(id,idempotency_key,technician_account_id,transaction_type,amount,balance_before,balance_after,
            reference_type,reference_id,description,created_at)
        VALUES(pg_temp.demo_id('opening-debt-'||i),'DEMO-OPENING-DEBT-'||i,aid,'ADJUSTMENT',-100000,0,-100000,
            'DEMO_OPENING','DEMO-OPENING-'||i,'Nợ đầu kỳ giả lập 100.000đ để minh họa đối soát; không phát sinh từ booking thật.',week_start-interval '13 days');
        UPDATE technician_accounts SET settlement_balance=-100000 WHERE id=aid;
    END LOOP;

    -- 4. Two currently valid demo vouchers; platform funded, exclude parts.
    INSERT INTO vouchers(id,code,name,discount_type,discount_value,minimum_order_amount,maximum_discount,
        usage_limit,usage_limit_per_customer,start_at,end_at)
    VALUES
        (pg_temp.demo_id('voucher-1'),'DEMO10','Demo giảm 10%','PERCENTAGE',10,200000,50000,100,5,CURRENT_TIMESTAMP-interval '30 days',CURRENT_TIMESTAMP+interval '90 days'),
        (pg_temp.demo_id('voucher-2'),'DEMO30K','Demo giảm 30.000đ','FIXED_AMOUNT',30000,250000,NULL,100,5,CURRENT_TIMESTAMP-interval '30 days',CURRENT_TIMESTAMP+interval '90 days');

    -- 5. Create completed bookings FIRST so the four technicians can take current work later.
    -- 01..03 cash; 04..06 online; 07..08 completed/unpaid; 09..14 pending;
    -- 15 accepted; 16 in progress; 17..18 pending quotation; 19..20 cancelled.
    FOR n IN 1..20 LOOP
        bid:=pg_temp.demo_id('booking-'||n); c:=1+((n-1)%4);
        cid:=pg_temp.demo_id('customer-'||c); uid:=pg_temp.demo_id('user-'||c);
        s:=1+((n-1)%4); unit_count:=CASE WHEN n%3=0 THEN 2 ELSE 1 END;
        extra_s:=CASE WHEN n%4=0 THEN 2 ELSE 0 END;
        subtotal_value:=service_prices[s]*unit_count+CASE WHEN extra_s>0 THEN service_prices[extra_s] ELSE 0 END;
        INSERT INTO bookings(id,booking_code,customer_id,customer_address_id,recipient_name,recipient_phone,description,
            service_address,ward,city,scheduled_at,subtotal,total_amount,created_at)
        SELECT bid,'DEMO-BK-'||lpad(n::text,3,'0'),cid,id,recipient_name,phone,
            'Booking demo '||n||'; thông tin giả lập, không gửi thông báo thực tế.',address_line,ward,city,
            CASE WHEN n<=8 THEN CURRENT_TIMESTAMP-interval '3 hours'
                 WHEN n IN (16,17,18) THEN CURRENT_TIMESTAMP-interval '1 hour'
                 ELSE CURRENT_TIMESTAMP+make_interval(days=>1+n%7) END,
            subtotal_value,subtotal_value,CURRENT_TIMESTAMP-interval '1 day'
        FROM customer_addresses WHERE id=pg_temp.demo_id('address-'||c||'-1');
        INSERT INTO booking_status_history(booking_id,status,changed_by_id,note,created_at)
        VALUES(bid,'PENDING',uid,'Khách tạo lịch demo',CURRENT_TIMESTAMP-interval '1 day');
        FOR j IN 1..unit_count LOOP
            unit_id:=pg_temp.demo_id('unit-'||n||'-'||j); brand_n:=1+((n+j-2)%5);
            INSERT INTO booking_units(id,booking_id,unit_number,ac_brand_id,ac_model_id,description)
            VALUES(unit_id,bid,j,pg_temp.demo_id('brand-'||brand_n),pg_temp.demo_id('model-'||brand_n||'-1'),'Máy lạnh demo số '||j);
            INSERT INTO booking_unit_services(id,booking_unit_id,service_id,unit_price)
            VALUES(pg_temp.demo_id('bus-'||n||'-'||j||'-1'),unit_id,pg_temp.demo_id('service-'||s),service_prices[s]);
            IF j=1 AND extra_s>0 THEN
                INSERT INTO booking_unit_services(id,booking_unit_id,service_id,unit_price)
                VALUES(pg_temp.demo_id('bus-'||n||'-'||j||'-2'),unit_id,pg_temp.demo_id('service-'||extra_s),service_prices[extra_s]);
            END IF;
        END LOOP;
        IF n BETWEEN 9 AND 14 THEN CONTINUE; END IF;
        IF n>=19 THEN
            UPDATE bookings SET status='CANCELLED',cancelled_at=CURRENT_TIMESTAMP,cancelled_by_id=uid,
                cancellation_reason='Khách đổi kế hoạch — tình huống demo',updated_at=CURRENT_TIMESTAMP WHERE id=bid;
            INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
            VALUES(bid,'CANCELLED',uid,'Hủy trước khi có thợ nhận; chưa thu tiền');
            CONTINUE;
        END IF;
        t:=CASE WHEN n<=6 THEN 1+(n-1)%3 WHEN n<=8 THEN 4 ELSE n-14 END;
        tid:=pg_temp.demo_id('tech-'||t);
        INSERT INTO booking_technicians(id,booking_id,technician_id,status,match_score,match_reason,requested_at,responded_at)
        VALUES(pg_temp.demo_id('assignment-'||n),bid,tid,'ACCEPTED',95,'Khớp dịch vụ, hãng và khu vực demo Cần Thơ',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        UPDATE bookings SET status='ACCEPTED',updated_at=CURRENT_TIMESTAMP WHERE id=bid;
        INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
        VALUES(bid,'ACCEPTED',pg_temp.demo_id('user-'||(t+4)),'KTV nhận booking demo');
        IF n=15 THEN CONTINUE; END IF;
        UPDATE bookings SET status='IN_PROGRESS',updated_at=CURRENT_TIMESTAMP WHERE id=bid;
        INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
        VALUES(bid,'IN_PROGRESS',pg_temp.demo_id('user-'||(t+4)),'Bắt đầu kiểm tra máy demo');
        IF n=16 THEN CONTINUE; END IF;

        qid:=pg_temp.demo_id('quote-'||n); parts_value:=CASE WHEN n>=17 THEN 180000 ELSE 0 END;
        INSERT INTO quotations(id,booking_id,technician_id,quotation_number,quotation_type,parts_amount,subtotal,total_amount,status,
            issue_description,note,sent_at,expires_at)
        VALUES(qid,bid,tid,1,'INITIAL',parts_value,subtotal_value+parts_value,subtotal_value+parts_value,'PENDING',
            'Kiểm tra máy lạnh demo','Chi phí linh kiện chỉ lưu tổng, cần khách đồng ý.',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+interval '2 days');
        INSERT INTO quotation_items(quotation_id,booking_unit_service_id,item_type,service_id,description,quantity,unit,unit_price,total_price)
        SELECT qid,bs.id,'SERVICE',bs.service_id,sv.name,1,'lần',bs.unit_price,bs.unit_price
        FROM booking_unit_services bs JOIN booking_units bu ON bu.id=bs.booking_unit_id JOIN services sv ON sv.id=bs.service_id
        WHERE bu.booking_id=bid;
        UPDATE bookings SET status='QUOTATION_SENT',updated_at=CURRENT_TIMESTAMP WHERE id=bid;
        INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
        VALUES(bid,'QUOTATION_SENT',pg_temp.demo_id('user-'||(t+4)),'Gửi báo giá cho khách duyệt');
        IF n>=17 THEN CONTINUE; END IF;
        UPDATE quotations SET status='ACCEPTED',responded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=qid;
        IF n IN (2,5,8) THEN
            qextra:=pg_temp.demo_id('additional-'||n);
            INSERT INTO quotations(id,booking_id,technician_id,quotation_number,quotation_type,issue_description,labor_amount,parts_amount,
                subtotal,total_amount,status,sent_at,responded_at,note)
            VALUES(qextra,bid,tid,2,'ADDITIONAL','Phát hiện hư hỏng cần thay linh kiện; khách đã đồng ý trong demo',50000,300000,
                350000,350000,'ACCEPTED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'Chỉ phần tăng thêm: công 50.000đ và tổng linh kiện 300.000đ');
            INSERT INTO quotation_items(quotation_id,item_type,description,quantity,unit,unit_price,total_price)
            VALUES(qextra,'LABOR','Công xử lý phát sinh demo',1,'lần',50000,50000);
        END IF;
        selected_voucher:=CASE WHEN n IN (3,4,8) THEN pg_temp.demo_id('voucher-1')
            WHEN n=6 THEN pg_temp.demo_id('voucher-2') ELSE NULL END;
        PERFORM refresh_booking_pricing(bid,selected_voucher);
        UPDATE bookings SET status='QUOTATION_ACCEPTED',updated_at=CURRENT_TIMESTAMP WHERE id=bid;
        INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
        VALUES(bid,'QUOTATION_ACCEPTED',uid,'Khách duyệt báo giá và phần phát sinh nếu có');
        UPDATE bookings SET technician_completed_by_id=pg_temp.demo_id('user-'||(t+4)),technician_completed_at=CURRENT_TIMESTAMP,
            completion_confirmed_by_id=uid,completion_confirmed_at=CURRENT_TIMESTAMP,
            charges_confirmed_by_id=uid,charges_confirmed_at=CURRENT_TIMESTAMP WHERE id=bid;
        INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
        VALUES(bid,'COMPLETED',uid,'Cả KTV và khách xác nhận hoàn thành và khách duyệt chi phí cuối');
        UPDATE booking_units SET diagnosis='Đã kiểm tra trong kịch bản demo',service_notes='Hoàn tất dịch vụ đã duyệt',
            serviced_at=CURRENT_TIMESTAMP,next_maintenance_at=CASE WHEN s IN (1,3) THEN CURRENT_TIMESTAMP+interval '180 days' ELSE NULL END
        WHERE booking_id=bid;
        inv_id:=pg_temp.demo_id('invoice-'||n);
        INSERT INTO invoices(id,invoice_number,booking_id,customer_id,parts_amount,subtotal,discount_amount,total_amount,issued_at)
        SELECT inv_id,'DEMO-INV-'||lpad(n::text,3,'0'),b.id,b.customer_id,
            (SELECT sum(parts_amount) FROM quotations WHERE booking_id=bid AND status='ACCEPTED'),b.subtotal,b.discount_amount,b.total_amount,CURRENT_TIMESTAMP
        FROM bookings b WHERE b.id=bid;
        INSERT INTO invoice_items(invoice_id,quotation_item_id,booking_unit_service_id,item_type,description,quantity,unit,unit_price,total_price,discount_amount)
        SELECT inv_id,qi.id,qi.booking_unit_service_id,qi.item_type,qi.description,qi.quantity,qi.unit,qi.unit_price,qi.total_price,0
        FROM quotation_items qi JOIN quotations q ON q.id=qi.quotation_id WHERE q.booking_id=bid AND q.status='ACCEPTED';
        IF n<=6 THEN
            pid:=pg_temp.demo_id('payment-'||n);
            source_method:=CASE WHEN n<=3 THEN 'CASH' WHEN n=5 THEN 'ZALOPAY' ELSE 'VNPAY' END;
            SELECT id INTO method_id FROM payment_methods WHERE code=source_method;
            INSERT INTO payments(id,payment_code,idempotency_key,booking_id,customer_id,technician_id,amount,payment_method_id)
            SELECT pid,'DEMO-PAY-'||lpad(n::text,3,'0'),'DEMO-PAYMENT-'||n,bid,cid,tid,total_amount,method_id FROM bookings WHERE id=bid;
            UPDATE payments SET payment_status='PROCESSING',updated_at=CURRENT_TIMESTAMP WHERE id=pid;
            UPDATE payments SET payment_status='SUCCESS',paid_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,
                transaction_reference=CASE WHEN n>3 THEN 'DEMO-NOT-A-REAL-PAYMENT-'||n ELSE NULL END,
                cash_received_by_id=CASE WHEN n<=3 THEN pg_temp.demo_id('user-'||(t+4)) ELSE NULL END,
                cash_received_at=CASE WHEN n<=3 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=pid;
            IF n<=4 THEN
                INSERT INTO reviews(id,booking_id,customer_id,technician_id,rating,comment)
                VALUES(pg_temp.demo_id('review-'||n),bid,cid,tid,CASE WHEN n=2 THEN 4 ELSE 5 END,'Đánh giá giả lập: thợ đúng giờ, giải thích rõ chi phí.');
            END IF;
        END IF;
    END LOOP;

    -- Reviews are application-maintained aggregates in this schema.
    UPDATE technician_profiles tp SET rating_average=r.avg_rating,total_reviews=r.cnt,updated_at=CURRENT_TIMESTAMP
    FROM (SELECT technician_id,round(avg(rating),2) avg_rating,count(*)::integer cnt FROM reviews WHERE status='PUBLISHED' GROUP BY technician_id) r
    WHERE tp.id=r.technician_id;

    -- 6. Simulated successful topup, withdrawal, and pending withdrawal hold.
    row_id:=pg_temp.demo_id('topup-1');
    INSERT INTO technician_topups(id,idempotency_key,topup_code,technician_id,technician_account_id,amount,payment_method_id)
    VALUES(row_id,'DEMO-TOPUP-1','DEMO-TOPUP-001',pg_temp.demo_id('tech-3'),pg_temp.demo_id('account-3'),150000,
        (SELECT id FROM payment_methods WHERE code='VNPAY'));
    UPDATE technician_topups SET payment_status='PROCESSING' WHERE id=row_id;
    UPDATE technician_topups SET payment_status='SUCCESS',transaction_reference='DEMO-NOT-A-REAL-TOPUP',paid_at=CURRENT_TIMESTAMP WHERE id=row_id;
    row_id:=pg_temp.demo_id('withdrawal-1');
    INSERT INTO withdrawals(id,idempotency_key,technician_id,technician_account_id,amount,bank_name,account_number,account_holder,initiated_at,note)
    VALUES(row_id,'DEMO-WITHDRAWAL-1',pg_temp.demo_id('tech-2'),pg_temp.demo_id('account-2'),100000,
        'Ngân hàng giả lập','000000000002','TRAN QUOC HUY',CURRENT_TIMESTAMP,'Dữ liệu demo, không chuyển tiền thật');
    UPDATE withdrawals SET status='PROCESSING' WHERE id=row_id;
    UPDATE withdrawals SET status='SUCCESS',fee_amount=5000,payout_reference='DEMO-NOT-A-REAL-PAYOUT',paid_at=CURRENT_TIMESTAMP WHERE id=row_id;
    INSERT INTO withdrawals(id,idempotency_key,technician_id,technician_account_id,amount,bank_name,account_number,account_holder,initiated_at,note)
    VALUES(pg_temp.demo_id('withdrawal-2'),'DEMO-WITHDRAWAL-2',pg_temp.demo_id('tech-1'),pg_temp.demo_id('account-1'),100000,
        'Ngân hàng giả lập','000000000001','NGUYEN THANH HAI',CURRENT_TIMESTAMP,'Đang giữ tiền chờ xử lý — demo');

    -- Close two consecutive historical weeks after assignment of existing work.
    -- Tech 3 debt has been repaid by current credits; tech 4 remains overdue.
    FOR i IN 3..4 LOOP
        FOR j IN 1..2 LOOP
            row_id:=pg_temp.demo_id('settlement-'||i||'-'||j);
            INSERT INTO settlements(id,settlement_code,technician_id,technician_account_id,period_start,period_end,closing_balance)
            VALUES(row_id,'DEMO-SET-'||i||'-'||j,pg_temp.demo_id('tech-'||i),pg_temp.demo_id('account-'||i),
                week_start-make_interval(days=>21-7*j),week_start-make_interval(days=>14-7*j),0);
            UPDATE settlements SET status='CALCULATED' WHERE id=row_id;
        END LOOP;
    END LOOP;

    -- Small supplementary examples; no reset tokens or real OTP data.
    INSERT INTO chat_rooms(id,booking_id,customer_id,technician_id)
    VALUES(pg_temp.demo_id('chat-16'),pg_temp.demo_id('booking-16'),pg_temp.demo_id('customer-4'),pg_temp.demo_id('tech-2'));
    INSERT INTO chat_messages(room_id,sender_id,message_type,content)
    VALUES(pg_temp.demo_id('chat-16'),pg_temp.demo_id('user-4'),'TEXT','Tin nhắn demo: nhờ anh kiểm tra giúp máy lạnh.'),
          (pg_temp.demo_id('chat-16'),pg_temp.demo_id('user-6'),'TEXT','Tin nhắn demo: tôi sẽ báo chi phí trước khi xử lý.');
    INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
    VALUES(pg_temp.demo_id('user-1'),'BOOKING','Booking demo đã tạo','Dữ liệu giả lập để trình bày chức năng đặt lịch.','BOOKING',pg_temp.demo_id('booking-9')::text);
END;
$$;
DROP FUNCTION pg_temp.demo_id(text);
COMMIT;

-- Read-only summary after successful commit.
SELECT status, count(*) AS booking_count FROM bookings GROUP BY status ORDER BY status;
SELECT effective_status, count(*) AS period_count FROM settlement_debt_balances GROUP BY effective_status ORDER BY effective_status;
