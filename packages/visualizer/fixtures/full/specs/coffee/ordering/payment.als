// An order is paid once.
sig Order { paid: lone Payment }
sig Payment {}
fact { all o: Order | one o.paid }
