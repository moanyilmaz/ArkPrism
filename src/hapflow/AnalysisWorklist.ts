/** FIFO calls/returns precede LIFO normal edges, matching the solver's scheduling policy. */
export class AnalysisWorklist<T> {
    private ready: Array<T | undefined> = [];
    private head = 0;
    private deferred: T[] = [];

    get length(): number { return this.ready.length - this.head + this.deferred.length; }

    push(value: T): void { this.ready.push(value); }

    defer(value: T): void { this.deferred.push(value); }

    shift(): T | undefined {
        if (this.head < this.ready.length) {
            const value = this.ready[this.head];
            this.ready[this.head++] = undefined;
            if (this.head === this.ready.length) {
                this.ready = [];
                this.head = 0;
            } else if (this.head >= 4096 && this.head * 2 >= this.ready.length) {
                this.ready = this.ready.slice(this.head);
                this.head = 0;
            }
            return value;
        }
        return this.deferred.pop();
    }
}
