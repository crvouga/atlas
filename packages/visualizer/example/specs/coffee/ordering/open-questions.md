# Open questions

## Paying

1. **Should a declined card be kept for next time?** Nothing stores it today.
   - S: Told the payment was declined, Choosing how to pay.
   - T: Waiting for the payment → Payment provider declines the payment.
2. **How long can an order wait for the barista?** Nobody follows up on a long queue.
   - S: Paid, waiting for the barista.
   - T: Paid, waiting for the barista → Barista starts the drink.
   - Spec today: it waits **forever**.

## Pickup

3. **Refund or remake?** A drink left too long is refunded; a remake might be kinder.
   - S: Told the drink was thrown away (assumed). T: Drink ready for pickup → Drink sits ready for ten minutes.
4. **Who can pick the drink up?** Anyone at the counter can today.
   - T: Picks up the drink.

## Not modeled

5. These are outside this spec today:
   - tips
   - **gift cards** and promo codes
   - ordering for a later time
